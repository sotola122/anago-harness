import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { zipSync } from 'fflate'
import { expect, it } from 'vitest'
import { COVERAGE_TEST_TIMEOUT_ENV, coverageTestTimeoutOptions } from '../coverage-partitions.ts'
import { downloadPrimaryRuntimeAsset, prepareOfficeSkillAssets, primaryRuntimePayloadDigest, prunePnpmForeignNativePackages, smokePrimaryRuntime, unpackPrimaryRuntimeWheel } from './prepare.ts'
import lock from './lock.json' with { type: 'json' }

// Above the 15s product backoff between three attempts, and never below the lane budget.
const retryingDownloadTimeout = Math.max(45_000, coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV]).testTimeout ?? 0)

it('covers every SDK wheel target with the shared interpreter lock', () => {
  const platforms = JSON.parse(readFileSync(new URL('../../python/sdk-runtime/platforms.json', import.meta.url), 'utf8')) as Record<string, unknown>
  expect(Object.keys(lock.targets).sort()).toEqual(Object.keys(platforms).map(target => target.replace('macos-', 'mac-')).sort())
})

const libraryWheel = Buffer.from('UEsDBAoAAAAAAASeLl0sYMPjDAAAAAwAAAAJAAAAc2FtcGxlLnB5c2FtcGxlID0gNDIKUEsBAh4DCgAAAAAABJ4uXSxgw+MMAAAADAAAAAkAAAAAAAAAAQAAAKSBAAAAAHNhbXBsZS5weVBLBQYAAAAAAQABADcAAAAzAAAAAAA=', 'base64')
const relocatedWheel = Buffer.from('UEsDBAoAAAAAAASeLl3x0Nj9FAAAABQAAAAeAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlcmVxdWlyZXMgcmVsb2NhdGlvbgpQSwECHgMKAAAAAAAEni5d8dDY/RQAAAAUAAAAHgAAAAAAAAABAAAApIEAAAAAc2FtcGxlLTEuMC5kYXRhL3NjcmlwdHMvc2FtcGxlUEsFBgAAAAABAAEATAAAAFAAAAAAAA==', 'base64')
const externalLibraryWheel = Buffer.from('UEsDBBQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAc2FtcGxlLTEuMC5kYXRhL3B1cmVsaWIvc2FtcGxlLnB5cmVxdWlyZXMgbGlicmFyeSByZWxvY2F0aW9uClBLAQIUAxQAAAAAAAAAIVyBOE8OHAAAABwAAAAhAAAAAAAAAAAAAACAAQAAAABzYW1wbGUtMS4wLmRhdGEvcHVyZWxpYi9zYW1wbGUucHlQSwUGAAAAAAEAAQBPAAAAWwAAAAAA', 'base64')

it.each(Object.entries(lock.targets))('records every locked wheel distribution and version for %s', (_target, artifact) => {
  const normalize = (name: string): string => name.toLowerCase().replace(/[-_.]+/gu, '-')
  const distributions = [...artifact.wheels, ...lock.wheels].map(({ url }) => {
    const [name, version] = basename(new URL(url).pathname).split('-')
    return [normalize(name!), version] as const
  })
  const declared = Object.entries(lock.pythonPackages).map(([name, version]) => [normalize(name), version] as const)
  expect(new Set(distributions.map(([name]) => name)).size).toBe(distributions.length)
  expect(new Set(declared.map(([name]) => name)).size).toBe(declared.length)
  expect(Object.fromEntries(distributions)).toEqual(Object.fromEntries(declared))
})

it('keeps a target payload identity independent of other target archives', () => {
  const changed = structuredClone(lock)
  changed.targets['win-x64'].wheels[0]!.sha256 = 'a'.repeat(64)
  expect(primaryRuntimePayloadDigest('mac-arm64', changed, '11.7.0')).toBe(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0'))
  expect(primaryRuntimePayloadDigest('win-x64', changed, '11.7.0')).not.toBe(primaryRuntimePayloadDigest('win-x64', lock, '11.7.0'))
})

it('invalidates payload identity for shared wheels, package versions and package-manager changes', () => {
  const wheel = structuredClone(lock), distribution = structuredClone(lock)
  wheel.wheels[0]!.sha256 = 'a'.repeat(64)
  distribution.pythonPackages['python-docx'] = '1.2.1'
  const original = primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.0')
  expect(primaryRuntimePayloadDigest('mac-arm64', wheel, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', distribution, '11.7.0')).not.toBe(original)
  expect(primaryRuntimePayloadDigest('mac-arm64', lock, '11.7.1')).not.toBe(original)
})

it('reports missing distribution metadata before trying to execute a stale native payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-stale-runtime-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
      components: { python: '3.12.14', numpy: '2.3.5', pandas: '3.0.1' } }))
    expect(() => { smokePrimaryRuntime(root) }).toThrow('missing Python distribution versions; prepare the payload')
  } finally { await rm(root, { recursive: true, force: true }) }
})

// Native Windows payloads require python.exe rather than POSIX interpreter aliases.
it.skipIf(process.platform === 'win32')('rejects expanded interpreter aliases in the native payload smoke', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-expanded-aliases-'))
  try {
    await writeFile(join(root, 'runtime.json'), JSON.stringify({ desktopVersion: '1', platform: process.platform, arch: process.arch,
      python: '3.12.14', pythonPackages: { numpy: '2.3.5' } }))
    await mkdir(join(root, 'dependencies/python/bin'), { recursive: true })
    for (const name of ['python', 'python3', 'python3.12']) await writeFile(join(root, 'dependencies/python/bin', name), 'interpreter')
    expect(() => { smokePrimaryRuntime(root) }).toThrow('Python commands must be relative aliases')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('extracts a hash-verified cached library without a Python installer or network request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const hash = createHash('sha256').update(libraryWheel).digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, libraryWheel)
    const original = await stat(archive)
    expect(await downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).toBe(archive)
    const reused = await stat(archive)
    expect(reused.ino).toBe(original.ino)
    expect(reused.mtimeMs).toBe(original.mtimeMs)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample.py'), 'utf8')).toBe('sample = 42\n')
    await writeFile(archive, 'corrupt archive')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/library.whl', hash, root)).rejects.toThrow('checksum mismatch')
    await expect(stat(archive)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('fully extracts a large deflate-compressed wheel entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-large-wheel-'))
  try {
    const expected = Buffer.alloc(1024 * 1024)
    // Seeded xorshift bytes keep the compressed entry larger than the stream buffers.
    let state = 26
    for (let index = 0; index < expected.length; index++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      expected[index] = state & 255
    }
    const archive = join(root, 'large.whl')
    await writeFile(archive, zipSync({ 'large.bin': expected }, { level: 6 }))
    await unpackPrimaryRuntimeWheel(archive, root)
    // Native byte equality avoids a per-byte matcher traversal for this 1 MiB expected output.
    expect((await readFile(join(root, 'large.bin'))).equals(expected)).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('retains auxiliary wheel scripts without generating command wrappers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, relocatedWheel)
    await unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))
    expect(await readFile(join(root, 'site-packages/sample-1.0.data/scripts/sample'), 'utf8')).toBe('requires relocation\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects library files requiring an unsupported installation scheme', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-wheel-'))
  try {
    const archive = join(root, 'relocated.whl')
    await writeFile(archive, externalLibraryWheel)
    await expect(unpackPrimaryRuntimeWheel(archive, join(root, 'site-packages'))).rejects.toThrow('unsupported installation paths')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('copies complete Office resources outside the application archive and removes obsolete assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-office-assets-'))
  try {
    const source = join(root, 'package', 'assets')
    const destination = join(root, 'Contents', 'Resources', 'runtime', 'office-skills')
    await mkdir(source, { recursive: true })
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      await mkdir(join(source, name))
      await writeFile(join(source, name, 'SKILL.md'), `# ${name}\n`)
    }
    await prepareOfficeSkillAssets(source, destination)
    await writeFile(join(destination, 'obsolete.py'), 'old helper')
    await prepareOfficeSkillAssets(source, destination)
    for (const name of ['office-docx', 'office-pptx', 'office-xlsx']) {
      expect(await readFile(join(destination, name, 'SKILL.md'), 'utf8')).toBe(`# ${name}\n`)
    }
    await expect(readFile(join(destination, 'obsolete.py'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('gives Python-only payloads a distinct identity', () => {
  expect(primaryRuntimePayloadDigest('linux-x64', lock, undefined)).not.toBe(primaryRuntimePayloadDigest('linux-x64', lock, '11.7.0'))
})

it('keeps carrier pnpm versions aligned with the shared payload build', () => {
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    packageManager: string
    devDependencies: { pnpm: string }
  }
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8')) as {
    devDependencies: { pnpm: string }
  }
  expect(desktop.devDependencies.pnpm).toBe(root.devDependencies.pnpm)
  expect(root.packageManager).toBe(`pnpm@${root.devDependencies.pnpm}`)
})

it.each([
  ['darwin', 'arm64', ['reflink', 'reflink-darwin-arm64'], ['.bin', '@reflink', 'any-cpu', 'not-windows', 'semver']],
  ['darwin', 'x64', ['reflink', 'reflink-darwin-x64'], ['.bin', '@reflink', 'any-cpu', 'not-windows', 'semver']],
  ['win32', 'x64', ['reflink', 'reflink-win32-x64-msvc'], ['.bin', '@reflink', 'any-cpu', 'not-darwin', 'semver']],
] as const)('keeps only pnpm-bundled packages that %s/%s admits', async (platform, arch, reflink, top) => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-natives-'))
  try {
    const modules = join(root, 'dist', 'node_modules')
    const packages: Record<string, { os?: string[]; cpu?: string[] }> = {
      'semver': {}, '@reflink/reflink': {}, 'any-cpu': { cpu: ['any'] },
      '@reflink/reflink-darwin-arm64': { os: ['darwin'], cpu: ['arm64'] },
      '@reflink/reflink-darwin-x64': { os: ['darwin'], cpu: ['x64'] },
      '@reflink/reflink-win32-x64-msvc': { os: ['win32'], cpu: ['x64'] },
      'not-windows': { os: ['!win32'] },
      'not-darwin': { os: ['!darwin'] },
      'contradictory': { os: ['darwin', 'win32', '!darwin', '!win32'] },
    }
    for (const [name, fields] of Object.entries(packages)) {
      await mkdir(join(modules, name), { recursive: true })
      await writeFile(join(modules, name, 'package.json'), JSON.stringify({ name, ...fields }))
    }
    await mkdir(join(modules, '.bin'))
    await writeFile(join(modules, '.modules.yaml'), '')
    prunePnpmForeignNativePackages(root, platform, arch)
    expect((await readdir(modules)).filter(name => name !== '.modules.yaml').sort()).toEqual(top)
    expect((await readdir(join(modules, '@reflink'))).sort()).toEqual(reflink)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('names the bundled manifest whose platform field is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-pnpm-invalid-'))
  try {
    await mkdir(join(root, 'dist', 'node_modules', 'invalid'), { recursive: true })
    await writeFile(join(root, 'dist', 'node_modules', 'invalid', 'package.json'), JSON.stringify({ os: 'darwin' }))
    expect(() => { prunePnpmForeignNativePackages(root, 'darwin', 'arm64') }).toThrow(/invalid.package\.json: npm platform constraints must be arrays of strings/u)
  } finally { await rm(root, { recursive: true, force: true }) }
})

async function withDownloadTimeout<T>(milliseconds: string, run: () => Promise<T>): Promise<T> {
  const key = 'DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS'
  const previous = process.env[key]
  process.env[key] = milliseconds
  try { return await run() }
  finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = previous
  }
}

async function serveLoopback(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
  })
  /* jscpd:ignore-start -- loopback listen stays local; the failure text differs. */
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('download fixture has no TCP address')
  /* jscpd:ignore-end */
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      if (!server.listening) return
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => { if (error) rejectClose(error); else resolveClose() })
      })
    },
  }
}

it('follows one redirect and publishes the locked bytes', async () => {
  const body = Buffer.from('redirected-archive')
  const hash = createHash('sha256').update(body).digest('hex')
  const hits: string[] = []
  const fixture = await serveLoopback((request, response) => {
    hits.push(request.url ?? '')
    if (request.url === '/archive') {
      response.writeHead(302, { location: '/file' })
      response.end()
      return
    }
    response.writeHead(200, { 'content-length': String(body.length) })
    response.end(body)
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-redirect-ok-'))
  try {
    expect(await downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, hash, root)).toBe(join(root, hash))
    expect((await readFile(join(root, hash))).equals(body)).toBe(true)
    expect(hits).toEqual(['/archive', '/file'])
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('stops after 20 redirects and does not retry the loop', async () => {
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    hits += 1
    response.writeHead(hits > 30 ? 500 : 302, hits > 30 ? undefined : { location: '/loop' })
    response.end()
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-redirect-loop-'))
  try {
    const pending = downloadPrimaryRuntimeAsset(`${fixture.origin}/loop`, 'ab'.repeat(32), root)
    await expect(pending).rejects.toMatchObject({ status: 302 })
    await expect(pending).rejects.toThrow('too many redirects')
    expect(hits).toBe(21)
    expect(await readdir(root)).toEqual([])
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
})

it.each([
  ['a malformed Location', 'http://[', /malformed redirect Location/],
  ['a non-HTTP Location', 'file:///tmp/archive', /unsupported redirect/],
  ['an empty Location', '', /redirect missing Location/],
] as const)('rejects %s instead of throwing from the response callback', async (_label, location, message) => {
  const uncaught: unknown[] = []
  const onUncaught = (error: unknown): void => { uncaught.push(error) }
  process.on('uncaughtException', onUncaught)
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    hits += 1
    response.writeHead(302, { location })
    response.end()
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-redirect-bad-'))
  try {
    const pending = downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, 'ab'.repeat(32), root)
    await expect(pending).rejects.toMatchObject({ status: 302 })
    await expect(pending).rejects.toThrow(message)
    await new Promise((resolveWait) => { setImmediate(resolveWait) })
    expect(uncaught).toEqual([])
    expect(hits).toBe(1)
    expect(await readdir(root)).toEqual([])
  } finally {
    process.off('uncaughtException', onUncaught)
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a redirect that omits Location', async () => {
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    hits += 1
    response.writeHead(302)
    response.end()
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-redirect-missing-'))
  try {
    const pending = downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, 'ab'.repeat(32), root)
    await expect(pending).rejects.toMatchObject({ status: 302 })
    await expect(pending).rejects.toThrow('redirect missing Location')
    expect(hits).toBe(1)
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('aborts a dripping body when the attempt deadline includes the redirect', async () => {
  const body = Buffer.from('x'.repeat(50))
  const hash = createHash('sha256').update(body).digest('hex')
  let starts = 0
  const sent: number[] = []
  const fixture = await serveLoopback((request, response) => {
    if (request.url === '/start') {
      starts += 1
      if (starts > 1) {
        response.writeHead(302, { location: '/file' })
        response.end()
        return
      }
      // Idle on this hop is under the deadline; the following drip is not, unless each hop gets a fresh timer.
      const wait = setTimeout(() => {
        if (response.destroyed || response.writableEnded) return
        response.writeHead(302, { location: '/file' })
        response.end()
      }, 100)
      response.on('close', () => { clearTimeout(wait) })
      return
    }
    if (starts > 1) {
      response.writeHead(200, { 'content-length': String(body.length) })
      response.end(body)
      return
    }
    response.writeHead(200, { 'content-length': String(body.length) })
    let offset = 0
    const drip = setInterval(() => {
      if (response.destroyed || response.writableEnded) { clearInterval(drip); return }
      response.write(body.subarray(offset, offset + 1))
      offset += 1
      if (offset === body.length) { clearInterval(drip); response.end() }
    }, 100)
    response.on('close', () => { clearInterval(drip); sent.push(offset) })
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-deadline-'))
  try {
    await withDownloadTimeout('2000', async () => {
      expect(await downloadPrimaryRuntimeAsset(`${fixture.origin}/start`, hash, root)).toBe(join(root, hash))
    })
    expect(starts).toBe(2)
    expect(sent[0]).toBeGreaterThan(0)
    expect(sent[0]).toBeLessThan(body.length)
    expect((await readFile(join(root, hash))).equals(body)).toBe(true)
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
}, retryingDownloadTimeout)

it('retries a truncated body until the three attempts are exhausted and publishes nothing', async () => {
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    hits += 1
    response.writeHead(200, { 'content-length': '100', connection: 'close' })
    response.write('partial')
    response.socket?.destroy()
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-truncated-'))
  try {
    await expect(downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, 'ab'.repeat(32), root)).rejects.toThrow(/truncated response/u)
    expect(hits).toBe(3)
    expect(await readdir(root)).toEqual([])
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
}, retryingDownloadTimeout)

it('retries 429 and 5xx and does not retry a final 4xx', async () => {
  const body = Buffer.from('retried-archive')
  const hash = createHash('sha256').update(body).digest('hex')
  const statuses = [429, 500, 200]
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    const status = statuses[hits] ?? 200
    hits += 1
    if (status !== 200) { response.writeHead(status).end(); return }
    response.writeHead(200, { 'content-length': String(body.length) })
    response.end(body)
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-retry-'))
  try {
    expect(await downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, hash, root)).toBe(join(root, hash))
    expect(hits).toBe(3)
    expect((await readFile(join(root, hash))).equals(body)).toBe(true)
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
  let clientErrors = 0
  const denied = await serveLoopback((_request, response) => {
    clientErrors += 1
    response.writeHead(404).end()
  })
  const deniedRoot = await mkdtemp(join(tmpdir(), 'primary-client-error-'))
  try {
    await expect(downloadPrimaryRuntimeAsset(`${denied.origin}/archive`, hash, deniedRoot)).rejects.toMatchObject({ status: 404 })
    expect(clientErrors).toBe(1)
    expect(await readdir(deniedRoot)).toEqual([])
  } finally {
    await denied.close()
    await rm(deniedRoot, { recursive: true, force: true })
  }
}, retryingDownloadTimeout)

it('does not publish a download whose digest does not match the lock', async () => {
  let hits = 0
  const fixture = await serveLoopback((_request, response) => {
    hits += 1
    response.end('not-the-archive')
  })
  const root = await mkdtemp(join(tmpdir(), 'primary-digest-'))
  try {
    await expect(downloadPrimaryRuntimeAsset(`${fixture.origin}/archive`, 'ab'.repeat(32), root)).rejects.toThrow('checksum mismatch')
    expect(hits).toBe(1)
    expect(await readdir(root)).toEqual([])
  } finally {
    await fixture.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects cached bytes whose SHA-512 does not match and deletes them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'primary-sha512-'))
  try {
    const hash = createHash('sha512').update('archive').digest('hex')
    const archive = join(root, hash)
    await writeFile(archive, 'corrupt')
    await expect(downloadPrimaryRuntimeAsset('https://unused.invalid/pkg.tgz', hash, root, 'sha512')).rejects.toThrow('checksum mismatch')
    await expect(stat(archive)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
