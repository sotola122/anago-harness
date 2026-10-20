'use strict'

// Installs once in the host process. Blocks TCP connects, DNS lookups, and proxy
// request targets whose hostname matches denylist.json. No environment variable
// disables that denylist.

const net = require('node:net')
const dns = require('node:dns')
const { syncBuiltinESMExports } = require('node:module')
const { domainToASCII } = require('node:url')
const { readFileSync, appendFileSync, writeSync, mkdtempSync, copyFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { isSea } = require('node:sea')

const GUARD = Symbol.for('dsh-fork.egress-guard')
if (!globalThis[GUARD]) install()

function install() {
  const rules = JSON.parse(readFileSync(join(__dirname, 'denylist.json'), 'utf8'))
  const suffixes = Object.values(rules.suffixes).flat()
  const hosts = new Set(rules.hosts)
  const logFile = process.env.DSH_FORK_EGRESS_LOG

  function normalize(host) {
    let normalized = String(host ?? '').trim().toLowerCase()
    if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1)
    while (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
    if (net.isIP(normalized)) return normalized
    return domainToASCII(normalized) || normalized
  }

  function isLoopbackOrLocal(host) {
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./u.test(host) || host === '0.0.0.0'
  }

  function verdict(rawHost) {
    const host = normalize(rawHost)
    if (host === '' || isLoopbackOrLocal(host)) return undefined
    if (net.isIP(host)) return undefined
    if (hosts.has(host)) return `host ${host}`
    for (const suffix of suffixes) if (host === suffix || host.endsWith(`.${suffix}`)) return `suffix ${suffix}`
    return undefined
  }

  function report(kind, host, reason) {
    const line = JSON.stringify({ t: new Date().toISOString(), pid: process.pid, kind, host: normalize(host), reason })
    try {
      writeSync(2, `dsh-fork egress-guard: BLOCKED ${line}\n`)
    } catch (error) {
      // stderr may already be closed; the socket refusal does not depend on this line.
      void error
    }
    if (logFile) {
      try {
        appendFileSync(logFile, `${line}\n`)
      } catch (error) {
        // A log-file failure must not replace the refusal.
        void error
      }
    }
  }

  function forbiddenError(host, reason) {
    const error = new Error(`dsh-fork egress guard blocked ${normalize(host)} (${reason})`)
    error.code = 'EDSHFORKFORBIDDEN'
    return error
  }

  // Proxy endpoints this process may tunnel through. Read on each connect because
  // the resolved proxy policy is published into process.env after startup.
  function proxyHosts() {
    const proxies = new Set()
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      const value = process.env[name]
      if (!value) continue
      try {
        proxies.add(normalize(new URL(value).hostname))
      } catch (error) {
        // An unparsable proxy value is not a tunnel this process can use.
        void error
      }
    }
    return proxies
  }

  const proxySocket = Symbol('dsh-fork.proxy-socket')
  const originalConnect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function connect(...args) {
    const normalized = Array.isArray(args[0]) ? args[0]
      : typeof net._normalizeArgs === 'function' ? net._normalizeArgs(args) : [args[0]]
    const options = (normalized[0] !== null && typeof normalized[0] === 'object') ? normalized[0] : {}
    if (options.path === undefined) {
      const host = options.host ?? 'localhost'
      const reason = verdict(host)
      if (reason !== undefined) {
        report('connect', host, reason)
        const error = forbiddenError(host, reason)
        process.nextTick(() => this.destroy(error))
        return this
      }
      if (proxyHosts().has(normalize(host))) this[proxySocket] = true
    }
    return originalConnect.apply(this, args)
  }

  const originalWrite = net.Socket.prototype.write
  net.Socket.prototype.write = function write(chunk, ...rest) {
    if (this[proxySocket] === true) {
      const head = Buffer.isBuffer(chunk) ? chunk.subarray(0, 512).toString('latin1') : String(chunk).slice(0, 512)
      const match = /^CONNECT\s+(\[[^\]]+\]|[^\s:]+)/u.exec(head)
        ?? /^[A-Z]+\s+[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^\s/:?#]+)/iu.exec(head)
      if (match) {
        const reason = verdict(match[1])
        if (reason !== undefined) {
          report('proxy-target', match[1], reason)
          this.destroy(forbiddenError(match[1], reason))
          return false
        }
      }
    }
    return originalWrite.call(this, chunk, ...rest)
  }

  const wrapCallback = (name, original) => function wrapped(hostname, ...rest) {
    const reason = verdict(hostname)
    if (reason !== undefined) {
      report(`dns.${name}`, hostname, reason)
      const callback = rest.at(-1)
      if (typeof callback === 'function') {
        process.nextTick(callback, Object.assign(forbiddenError(hostname, reason), { code: 'ENOTFOUND' }))
        return {}
      }
      throw forbiddenError(hostname, reason)
    }
    return original.call(this, hostname, ...rest)
  }

  const wrapPromise = (name, original) => async function wrapped(hostname, ...rest) {
    const reason = verdict(hostname)
    if (reason !== undefined) {
      report(`dns.promises.${name}`, hostname, reason)
      throw Object.assign(forbiddenError(hostname, reason), { code: 'ENOTFOUND' })
    }
    return original.call(this, hostname, ...rest)
  }

  const callbackNames = ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'resolveCaa', 'resolveNaptr', 'resolvePtr', 'resolveSoa']
  for (const name of callbackNames) {
    if (typeof dns[name] === 'function') dns[name] = wrapCallback(name, dns[name])
    if (typeof dns.Resolver.prototype[name] === 'function') dns.Resolver.prototype[name] = wrapCallback(name, dns.Resolver.prototype[name])
    if (typeof dns.promises[name] === 'function') dns.promises[name] = wrapPromise(name, dns.promises[name])
    if (typeof dns.promises.Resolver.prototype[name] === 'function') dns.promises.Resolver.prototype[name] = wrapPromise(name, dns.promises.Resolver.prototype[name])
  }
  syncBuiltinESMExports()

  // Node children inherit the guard through NODE_OPTIONS. The test runner sets
  // VITEST; leaving its child options unchanged does not disable the denylist
  // in the process that loaded this file. A single-file executable stores this
  // file in a snapshot path that a separate Node process cannot load, so that
  // case copies the guard and denylist to a real temporary directory first.
  const preloadFile = childPreloadPath()
  const preload = preloadFile === undefined ? '' : `--require=${preloadFile}`
  const nodeOptions = process.env.NODE_OPTIONS ?? ''
  if (process.env.VITEST === undefined && preloadFile !== undefined
    && !nodeOptions.includes(preloadFile) && !nodeOptions.includes(preload)) {
    process.env.NODE_OPTIONS = `${nodeOptions} ${preload}`.trim()
  }

  Object.defineProperty(globalThis, GUARD, { value: Object.freeze({ verdict, normalize }), enumerable: false })
}

function childPreloadPath() {
  if (!isSea()) return __filename
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fork-guard-'))
    const target = join(dir, 'egress-guard.cjs')
    copyFileSync(__filename, target)
    copyFileSync(join(__dirname, 'denylist.json'), join(dir, 'denylist.json'))
    return target
  } catch (error) {
    // A failed copy must not point child processes at a snapshot path.
    void error
    return undefined
  }
}

module.exports = { guard: globalThis[GUARD] }
