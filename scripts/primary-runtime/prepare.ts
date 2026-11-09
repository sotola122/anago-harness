/** Prepare pinned, relocatable script interpreters without installing into the build host. */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { get as httpGet, type IncomingMessage } from 'node:http'
import { get as httpsGet } from 'node:https'
import { parseArgs } from 'node:util'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { copyPrimaryRuntime, parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@deepseek-ai/dsh-tool-workspace-dependencies'
import { acceptsNpmPlatform } from '../npm-platform.ts'
import lock from './lock.json' with { type: 'json' }
import { prunePrimaryRuntimePythonTests } from './prune-python-tests.ts'


/** At most 20 redirects, matching fetch. A further redirect fails the attempt. */
const REDIRECT_LIMIT = 20

/**
 * Download failure. `status` is set for an HTTP response, including a redirect the client will not follow.
 * Absent `status` is a transport failure and is retried.
 * @param message - Operator-facing summary including the archive URL.
 * @param status - HTTP status, when the server sent one.
 * @param cause - Underlying parser or socket failure.
 * @returns Error the retry loop can classify without reading the message.
 */
function downloadFailure(message: string, status?: number, cause?: unknown): Error & { status?: number } {
  const failure = new Error(message, cause === undefined ? undefined : { cause }) as Error & { status?: number }
  if (status !== undefined) failure.status = status
  return failure
}

/**
 * Fetch a locked archive, retrying the gateway and network failures a release CDN returns intermittently.
 * Node's fetch parser aborts the process on a truncated compressed response, so this path owns the connection:
 * at most 20 redirects, a declared-length check, and truncation as a failed attempt. A client error, including
 * a malformed or missing redirect, is final.
 * @param url - Locked archive URL.
 * @param timeout - Wall-clock deadline for one attempt, including redirects and the body, in milliseconds.
 * @returns Archive bytes.
 */
async function fetchArchive(url: string, timeout: number): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let retryable = true
    try {
      return await download(url, timeout)
    }
    catch (error) {
      const status = (error as { status?: number }).status
      retryable = status === undefined || status >= 500 || status === 429
      lastError = error
    }
    if (!retryable) break
    if (attempt < 3) await new Promise<void>((resolveWait) => { setTimeout(resolveWait, attempt * 5_000) })
  }
  throw lastError instanceof Error ? lastError : new Error(`primary runtime download: ${url}`)
}

/**
 * Read one URL, following at most 20 redirects and refusing a short or unfinished body.
 * @param url - Archive URL.
 * @param timeout - Wall-clock deadline for this attempt, including redirects and the body, in milliseconds.
 * @returns Archive bytes.
 */
function download(url: string, timeout: number): Promise<Buffer> {
  const controller = new AbortController()
  // One deadline for every redirect and the body. A per-socket idle timer resets on each hop and each drip.
  const deadline = setTimeout(() => {
    controller.abort(downloadFailure(`primary runtime download: timeout ${url}`))
  }, timeout)
  return readArchive(url, controller.signal, 0).finally(() => { clearTimeout(deadline) })
}

/**
 * Read one hop. Redirect failures reject here, including a `Location` that is not a URL, so a bad header cannot
 * escape the response callback.
 * @param url - Current hop.
 * @param signal - Deadline for the whole attempt.
 * @param redirects - Redirects already followed.
 * @returns Archive bytes.
 */
function readArchive(url: string, signal: AbortSignal, redirects: number): Promise<Buffer> {
  return new Promise((resolveDownload, rejectDownload) => {
    if (signal.aborted) {
      rejectDownload(signal.reason instanceof Error ? signal.reason : downloadFailure(`primary runtime download: timeout ${url}`))
      return
    }
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      rejectDownload(downloadFailure(`primary runtime download: unsupported redirect ${url}`))
      return
    }
    let received = 0
    let reading = false
    let declared = Number.NaN
    const fail = (error: unknown): void => {
      const timedOut = signal.aborted && signal.reason instanceof Error ? signal.reason : undefined
      if (timedOut !== undefined) { rejectDownload(timedOut); return }
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
      // A reset before the response callback still means the archive did not arrive intact.
      const reset = code === 'ECONNRESET' || (error instanceof Error && error.message === 'aborted')
      if (reading || reset) {
        const declaredText = Number.isFinite(declared) ? String(declared) : 'unfinished'
        rejectDownload(downloadFailure(
          `primary runtime download: truncated response (${String(received)} of ${declaredText}) ${url}`,
          undefined,
          error instanceof Error ? error : undefined,
        ))
        return
      }
      rejectDownload(error instanceof Error ? error : downloadFailure(`primary runtime download: ${url}`))
    }
    const onResponse = (response: IncomingMessage): void => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        response.resume()
        const location = response.headers.location
        if (location === undefined || location === '') {
          rejectDownload(downloadFailure(`primary runtime download: redirect missing Location ${url}`, status))
          return
        }
        if (redirects >= REDIRECT_LIMIT) {
          rejectDownload(downloadFailure(`primary runtime download: too many redirects ${url}`, status))
          return
        }
        let next: URL
        try { next = new URL(location, parsed) }
        catch (error) {
          rejectDownload(downloadFailure(`primary runtime download: malformed redirect Location ${url}`, status, error))
          return
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          rejectDownload(downloadFailure(`primary runtime download: unsupported redirect ${url}`, status))
          return
        }
        readArchive(next.toString(), signal, redirects + 1).then(resolveDownload, rejectDownload)
        return
      }
      if (status !== 200) {
        response.resume()
        rejectDownload(downloadFailure(`primary runtime download: ${String(status)} ${url}`, status))
        return
      }
      reading = true
      declared = Number(response.headers['content-length'])
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk); received += chunk.length })
      response.on('end', () => {
        if (!response.complete || (Number.isFinite(declared) && declared !== received)) {
          fail(new Error('incomplete body'))
          return
        }
        resolveDownload(Buffer.concat(chunks))
      })
      response.on('error', fail)
    }
    const options = { headers: { 'accept-encoding': 'identity' }, signal }
    const request = parsed.protocol === 'https:' ? httpsGet(parsed, options, onResponse) : httpGet(parsed, options, onResponse)
    request.on('error', fail)
  })
}

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * A digest mismatch deletes the cache file and does not publish the bytes.
 * `DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS` is the wall-clock deadline for one attempt, including redirects and the body.
 * @param url - Locked archive URL.
 * @param sha256 - Expected hexadecimal digest for the selected algorithm.
 * @param cache - Download cache directory.
 * @param algorithm - Digest algorithm; npm archives use SHA-512.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(url: string, sha256: string, cache: string, algorithm: 'sha256' | 'sha512' = 'sha256'): Promise<string> {
  mkdirSync(cache, { recursive: true })
  const destination = join(cache, sha256)
  let bytes: Buffer
  let cached = true
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    cached = false
    const timeout = Number(process.env.DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS ?? '300000')
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('DSH_RESOURCE_DOWNLOAD_TIMEOUT_MS must be an integer from 1 to 2147483647')
    bytes = await fetchArchive(url, timeout)
  }
  if (createHash(algorithm).update(bytes).digest('hex') !== sha256) {
    rmSync(destination, { force: true })
    throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  }
  if (cached) return destination
  const temporary = join(cache, `.${randomUUID()}`)
  try {
    writeFileSync(temporary, bytes)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
  return destination
}

/** Pinned npm tarball, without dependency resolution or lifecycle scripts. */
export interface RuntimeNpmArchive {
  /** Exact published package name. */
  readonly name: string
  /** Exact published version. */
  readonly version: string
  /** Registry tarball URL. */
  readonly url: string
  /** npm SHA-512 integrity. */
  readonly integrity: string
}

/**
 * Download and unpack one locked npm package without running its scripts.
 * @param artifact - Published tarball identity and integrity.
 * @param destination - Empty package directory.
 * @param cache - Verified archive cache.
 * @returns Resolves after package identity validation.
 */
export async function downloadRuntimeNpmPackage(artifact: RuntimeNpmArchive, destination: string, cache: string): Promise<void> {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(artifact.integrity)) throw new Error(`runtime download: invalid integrity for ${artifact.name}`)
  const checksum = Buffer.from(artifact.integrity.slice(7), 'base64').toString('hex')
  const archive = await downloadPrimaryRuntimeAsset(artifact.url, checksum, cache, 'sha512')
  mkdirSync(destination, { recursive: true })
  await extractTar({ file: archive, cwd: destination, strip: 1 })
  const installed = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')) as { name?: string; version?: string }
  if (installed.name !== artifact.name || installed.version !== artifact.version) throw new Error(`runtime download: package identity mismatch for ${artifact.name}`)
}

/**
 * Prepare the locked standalone Node independently of Python and pnpm.
 * @param target - Target interpreter platform.
 * @param destination - Directory receiving bin/node and LICENSE.
 * @param cache - Verified archive cache.
 * @returns Resolves after extracting the interpreter.
 */
export async function downloadNodeRuntime(target: PrimaryRuntimeTarget, destination: string, cache: string): Promise<void> {
  const artifact = lock.targets[target]
  const filename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
  const archive = await downloadPrimaryRuntimeAsset(`https://nodejs.org/dist/v${lock.nodeVersion}/${filename}`, artifact.nodeSha256, cache)
  const staging = mkdtempSync(join(tmpdir(), 'dsh-node-'))
  try {
    if (target === 'win-x64') await extractZip(archive, { dir: staging })
    else await extractTar({ file: archive, cwd: staging })
    const source = join(staging, filename.replace(/\.(?:zip|tar\.gz)$/u, ''))
    mkdirSync(join(destination, 'bin'), { recursive: true })
    cpSync(join(source, ...(target === 'win-x64' ? ['node.exe'] : ['bin', 'node'])),
      join(destination, 'bin', target === 'win-x64' ? 'node.exe' : 'node'))
    cpSync(join(source, 'LICENSE'), join(destination, 'LICENSE'))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function pythonArchive(target: keyof typeof lock.targets, cache: string): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  return downloadPrimaryRuntimeAsset(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Runtime target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param pnpmVersion - Package-manager version copied into the payload.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(
  target: keyof typeof lock.targets, runtimeLock: typeof lock, pnpmVersion: string | undefined,
): string {
  const { pythonVersion, pythonRelease, nodeVersion, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 8, target, pythonVersion, pythonRelease, nodeVersion: pnpmVersion === undefined ? undefined : nodeVersion,
    artifact: runtimeLock.targets[target], wheels, pythonPackages, pnpm: pnpmVersion,
  })).digest('hex')
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Remove packages bundled directly under pnpm's dist/node_modules whose npm `os`/`cpu` fields exclude the target.
 * The pnpm tarball carries every platform's optional native packages, such as `@reflink/reflink-darwin-x64`.
 * Nested node_modules and the `libc` field are not inspected; pnpm 11 bundles neither nested native packages nor Linux variants.
 * @param pnpm - Unpacked pnpm package directory.
 * @param platform - Target Node.js platform.
 * @param arch - Target Node.js architecture.
 * @throws When a bundled package manifest is missing or has invalid `os`/`cpu` fields.
 */
export function prunePnpmForeignNativePackages(pnpm: string, platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  const modules = join(pnpm, 'dist', 'node_modules')
  const directories = (parent: string): string[] => readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '.bin').map(entry => join(parent, entry.name))
  for (const directory of directories(modules).flatMap(entry => basename(entry).startsWith('@') ? directories(entry) : [entry])) {
    const { os, cpu } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { os?: unknown; cpu?: unknown }
    let admitted: boolean
    try { admitted = acceptsNpmPlatform(os, platform) && acceptsNpmPlatform(cpu, arch) } catch (error) {
      throw new Error(`primary runtime: ${directory}/package.json: ${(error as Error).message}`, { cause: error })
    }
    if (!admitted) rmSync(directory, { recursive: true })
  }
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - External Office skill resource directory.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/** A locked interpreter and wheel target. */
export type PrimaryRuntimeTarget = keyof typeof lock.targets

/** Resource preparation inputs shared by builds and explicit SDK downloads. */
export interface PreparePrimaryRuntimeOptions {
  /** Target whose archives and wheels are downloaded. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** SHA-256-addressed archive cache. */
  readonly cache: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
  /** Locked npm pnpm tarball for installed carriers; build hosts otherwise copy their installed pnpm. */
  readonly pnpmArchive?: RuntimeNpmArchive
  /** Ordinary filesystem Office assets; build hosts otherwise resolve the workspace package. */
  readonly skillSource?: string
  /** Omit Node.js and pnpm for carriers providing only Python. */
  readonly pythonOnly?: boolean
}

/**
 * Materialize locked interpreters, libraries and Office resources without executing target code.
 * @param options - Explicit target and carrier-owned output locations.
 * @returns Resolves after the complete payload and skills have been copied to the output directory.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions): Promise<void> {
  const { target } = options
  const paths = { runtime: resolve(options.output), downloads: resolve(options.cache) }
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'dsh-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    const platform = target === 'win-x64' ? 'win32' : target.startsWith('linux-') ? 'linux' : 'darwin'
    const arch = target.endsWith('-arm64') ? 'arm64' : 'x64'
    let pnpmVersion: string | undefined
    if (!options.pythonOnly) {
      const node = join(dependencies, 'node')
      await downloadNodeRuntime(target, node, paths.downloads)
      mkdirSync(join(node, 'node_modules'))
      writeFileSync(join(node, 'node_modules', 'README.txt'), 'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
      if (options.pnpmArchive !== undefined) {
        pnpmVersion = options.pnpmArchive.version
        await downloadRuntimeNpmPackage(options.pnpmArchive, join(dependencies, 'pnpm'), paths.downloads)
      } else {
        const pnpmManifest = createRequire(import.meta.url).resolve('pnpm')
        pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
        await cp(dirname(pnpmManifest), join(dependencies, 'pnpm'), { recursive: true, dereference: true })
      }
      prunePnpmForeignNativePackages(join(dependencies, 'pnpm'), platform, arch)
    }
    await extractTar({ file: await pythonArchive(target, paths.downloads), cwd: dependencies })
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: options.version,
      platform,
      arch,
      payloadDigest: primaryRuntimePayloadDigest(target, lock, pnpmVersion),
      python: lock.pythonVersion,
      ...(pnpmVersion === undefined ? {} : { node: lock.nodeVersion, pnpm: pnpmVersion }),
      pythonPackages: lock.pythonPackages,
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const wheel of [...lock.targets[target].wheels, ...lock.wheels]) {
      await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads), entries.pythonPackages)
    }
    prunePrimaryRuntimePythonTests(entries.pythonPackages)
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    await copyPrimaryRuntime(output, destination, manifest)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const assets = options.skillSource ?? join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')), 'assets')
  await prepareOfficeSkillAssets(assets,
    join(paths.runtime, 'office-skills'))
}

/**
 * Execute the native payload's interpreters, package manager and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 * @param environment - Scrubbed subprocess environment; defaults to excluding credential-shaped names.
 */
export function smokePrimaryRuntime(root: string, environment: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)),
)): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (manifest.platform !== 'win32') {
    const interpreter = `python${manifest.python.split('.').slice(0, 2).join('.')}`
    for (const name of ['python', 'python3']) {
      const path = join(dirname(entries.python), name)
      if (!lstatSync(path).isSymbolicLink() || readlinkSync(path) !== interpreter) {
        throw new Error(`primary runtime: Python commands must be relative aliases of ${interpreter}`)
      }
    }
    if (!lstatSync(join(dirname(entries.python), interpreter)).isFile()) throw new Error('primary runtime: versioned Python must be a regular file')
  }
  const options = { stdio: 'inherit', timeout: 120_000, env: environment } as const
  execFileSync(entries.python, ['-I', '-B', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], options)
  execFileSync(entries.python, ['-I', '-B', join(import.meta.dirname, 'smoke.py'), JSON.stringify(manifest.pythonPackages),
    manifest.python], options)
  execFileSync(entries.python, ['-I', '-B', '-m', 'pip', 'check'], options)
  if (entries.node !== undefined) execFileSync(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`], options)
  if (entries.pnpm !== undefined && entries.node !== undefined) execFileSync(entries.node, [entries.pnpm, '--version'], options)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
    'python-only': { type: 'boolean', default: false },
  } })
  if (!values.target || !Object.hasOwn(lock.targets, values.target) || !values.output) {
    throw new Error(`Usage: pnpm run prepare:primary-runtime --target <${Object.keys(lock.targets).join('|')}> --output <directory> [--cache <directory>] [--python-only]`)
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  const output = resolve(values.output)
  await preparePrimaryRuntime({
    target: values.target as PrimaryRuntimeTarget, output,
    cache: values.cache ?? join(tmpdir(), 'dsh-primary-runtime-downloads'), version,
    pythonOnly: values['python-only'],
  })
  smokePrimaryRuntime(join(output, 'primary-runtime'))
}
