/** Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. */
import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import type { DesktopRuntimeDescriptor, DesktopRuntimeFile } from '../src/runtime-tree.ts'

/** Packaging event written after the self-sign hook appends Authenticode to one file. */
export const SELF_SIGN_REWRITE_EVENT = 'windows-self-sign-rewritten'

/**
 * Recorded reason a self-sign hash may be skipped.
 * Authenticode appends a certificate table after the preparation inventory is sealed.
 */
export const AUTHENTICODE_APPENDED = 'authenticode-appended'

/** One inventory path whose hash the self-sign hook recorded as rewritten. */
export interface ArchiveHashExclusion {
  readonly path: string
  readonly reason: typeof AUTHENTICODE_APPENDED
}

/** Rewrite records under the unpacked dsh tree, plus how many rewrite records the journal contained. */
export interface AuthenticodeArchiveExclusions {
  readonly exclusions: readonly ArchiveHashExclusion[]
  readonly rewriteRecords: number
}

/**
 * Map recorded self-sign rewrites to archive inventory paths.
 * Records outside `app.asar.unpacked/dsh` are counted and ignored; they are not archive members.
 * @param events - Packaging `events.jsonl` text. A malformed line or a rewrite record without the Authenticode reason fails the check.
 * @param unpackedDsh - Absolute unpacked dsh directory the hook may have rewritten.
 * @returns Inventory paths whose hashes Authenticode may have changed, and the rewrite-record count.
 */
export function authenticodeArchiveExclusions(events: string, unpackedDsh: string): AuthenticodeArchiveExclusions {
  const paths = new Set<string>()
  let rewriteRecords = 0
  for (const line of events.split('\n')) {
    if (line.trim() === '') continue
    const rewritten = rewritePath(line)
    if (rewritten === undefined) continue
    rewriteRecords += 1
    const path = inventoryPath(unpackedDsh, rewritten)
    if (path !== undefined) paths.add(path)
  }
  return {
    exclusions: [...paths].sort().map(path => ({ path, reason: AUTHENTICODE_APPENDED })),
    rewriteRecords,
  }
}

/**
 * Compare the complete archived dsh tree with the sealed preparation inventory.
 * Unsigned and eToken routes pass no exclusions. A self-sign exclusion skips only a hash the hook recorded as rewritten.
 * @param archivePath - Application ASAR file beside its unpacked directory.
 * @param expected - Verified preparation descriptor, including its complete file inventory.
 * @param exclusions - Inventory paths whose bytes the self-sign hook recorded as Authenticode-appended. Omitted, every hash is compared.
 * @returns Resolves when bytes, file membership and meaningful executable permissions match.
 * An excluded path must still be an unpacked member of both inventories.
 */
export async function verifyRuntimeArchive(
  archivePath: string, expected: DesktopRuntimeDescriptor, exclusions: readonly ArchiveHashExclusion[] = [],
): Promise<void> {
  const skipped = acceptedExclusions(exclusions)
  const archive = await readAsar(archivePath)
  const descriptor = await archive.readFile(join('dsh', 'desktop-runtime.json'))
  if (!descriptor.equals(Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`))) {
    throw new Error('desktop runtime: archived descriptor differs from preparation')
  }
  const files: DesktopRuntimeFile[] = []
  const unpacked = new Set<string>()
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`desktop runtime: unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archivePath}.unpacked`, name)) : undefined
    if (physical !== undefined && !physical.isFile()) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
    if (node.unpacked === true) unpacked.add(join(`${archivePath}.unpacked`, name))
    if (skipped.has(path) && node.unpacked !== true) throw new Error(`desktop runtime: signed file is not unpacked: ${path}`)
    if (path === 'desktop-runtime.json') return
    const body = await archive.readFile(name)
    // ASAR stores only owner-execute; group/other-only executable files fail the inventory comparison.
    const executable = process.platform !== 'win32' && (physical !== undefined
      ? (physical.mode & 0o111) !== 0
      : node.executable === true)
    files.push({ path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), executable })
  }
  await visit(archive.getFile('dsh', false), '')
  const entries = await readdir(join(`${archivePath}.unpacked`, 'dsh'), { recursive: true, withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && unpacked.size === 0) return []
      throw error
    })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || !unpacked.has(path)) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  for (const path of skipped.keys()) {
    if (!files.some(file => file.path === path) || !expected.files.some(file => file.path === path)) {
      throw new Error(`desktop runtime: signed file is not in both inventories: ${path}`)
    }
  }
  const comparable = (items: readonly DesktopRuntimeFile[]): DesktopRuntimeFile[] => items.filter(file => !skipped.has(file.path))
  const actual = comparable(files)
  const sealed = comparable(expected.files)
  if (JSON.stringify(actual) !== JSON.stringify(sealed)) throw new Error(integrityFailure(actual, sealed, skipped.size))
}

function acceptedExclusions(exclusions: readonly ArchiveHashExclusion[]): Map<string, ArchiveHashExclusion> {
  const skipped = new Map<string, ArchiveHashExclusion>()
  for (const exclusion of exclusions) {
    if (exclusion.reason !== AUTHENTICODE_APPENDED || !inventoryMember(exclusion.path)) {
      throw new Error(`desktop runtime: refusing archive hash exclusion ${exclusion.path || '(empty)'}`)
    }
    if (skipped.has(exclusion.path)) throw new Error(`desktop runtime: duplicate archive hash exclusion ${exclusion.path}`)
    skipped.set(exclusion.path, exclusion)
  }
  return skipped
}

function inventoryMember(path: string): boolean {
  return path !== '' && !path.includes('\\') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function inventoryPath(unpackedDsh: string, file: string): string | undefined {
  const suffix = relative(resolve(unpackedDsh), resolve(file))
  if (suffix === '' || isAbsolute(suffix)) return undefined
  const parts = suffix.split(sep)
  if (parts.some(part => part === '' || part === '.' || part === '..')) return undefined
  return parts.join('/')
}

function rewritePath(line: string): string | undefined {
  const value = parsedEvent(line)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('desktop runtime: invalid self-sign rewrite record')
  }
  if (field(value, 'type') !== SELF_SIGN_REWRITE_EVENT) return undefined
  const path = field(value, 'path')
  if (field(value, 'reason') !== AUTHENTICODE_APPENDED || typeof path !== 'string' || path === '') {
    throw new Error('desktop runtime: invalid self-sign rewrite record')
  }
  return path
}

function parsedEvent(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch (error) {
    throw new Error(`desktop runtime: invalid self-sign rewrite record: ${line.slice(0, 120)}`, { cause: error })
  }
}

function field(value: object, name: string): unknown {
  return Object.hasOwn(value, name) ? Reflect.get(value, name) : undefined
}

function integrityFailure(actual: readonly DesktopRuntimeFile[], expected: readonly DesktopRuntimeFile[], excluded: number): string {
  const actualByPath = new Map(actual.map(file => [file.path, file]))
  const expectedPaths = new Set(expected.map(file => file.path))
  const details: string[] = []
  for (const file of expected) {
    const seen = actualByPath.get(file.path)
    if (seen === undefined) details.push(`missing ${file.path}`)
    else if (seen.sha256 !== file.sha256 || seen.bytes !== file.bytes || seen.executable !== file.executable) {
      details.push(`${file.path} sha256 ${seen.sha256} != ${file.sha256} bytes ${String(seen.bytes)} != ${String(file.bytes)}`)
    }
  }
  for (const file of actual) if (!expectedPaths.has(file.path)) details.push(`extra ${file.path}`)
  const shown = details.slice(0, 8).join('; ')
  const more = details.length > 8 ? `; +${String(details.length - 8)} more` : ''
  const note = excluded === 0 ? '' : ` (${String(excluded)} authenticode-appended file(s) excluded)`
  const summary = shown === '' ? 'inventory mismatch' : `${shown}${more}`
  return `desktop runtime: ASAR integrity verification failed${note}: ${summary}. Unsigned and eToken builds exclude nothing; on self-sign a grown PE was signed without a rewrite record, and any other mismatch is a corrupt archive.`
}
