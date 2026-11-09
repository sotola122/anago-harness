/** Public-key verification result; no hardware authentication is performed. */
export interface WindowsRuntimeSignature {
  status: string
  timestamped: boolean
  thumbprint: string | null
}

/**
 * Read Windows trust, timestamp and signer identity using the engine's bundled modules, without accessing the private key.
 * @param path File to inspect.
 * @returns Authenticode verification result.
 */
export function inspectWindowsRuntimeSignature(path: string): Promise<WindowsRuntimeSignature>

/**
 * Preserve a copied primary-runtime executable only after signature and exact-byte verification.
 * @param path Signing-hook target.
 * @param options Prepared and copied runtime roots with retained audit directory.
 * @returns True for a verified runtime copy; false for targets outside that directory.
 */
export function preserveWindowsRuntimeSignature(path: string, options: {
  sourceRoot: string
  destinationRoot: string
  runDirectory: string
  inspect?: typeof inspectWindowsRuntimeSignature
}): Promise<boolean>

/** Supervised signing dependencies shared by all Windows release trees. */
export interface WindowsCodeSigningOptions {
  thumbprint: string
  sign: ReturnType<typeof import('./windows-sign.mjs').createWindowsTokenSigner>
  inspect?: typeof inspectWindowsRuntimeSignature
  record: (event: object) => void
  /** Hardware-free restores on distinct targets; concurrency is a resolved positive integer. All restores and their verification drain before serial signing starts. */
  cache?: {
    restore: import('./windows-signature-cache.mjs').WindowsCachedSigner['restore']
    concurrency: number
  }
}

/**
 * Enumerate PE files by content without following links.
 * @param root Materialized directory to scan.
 * @returns Sorted PE paths; eight bounded readers reject links or malformed executables and drain open handles before failure.
 */
export function windowsRuntimeCode(root: string): Promise<string[]>

/**
 * Preserve valid signatures and sign unsigned PE files with a supervised signer.
 * @param root Materialized directory to sign.
 * @param options Signer, certificate identity and audit sink.
 * @returns Resolves after parallel cache restores, batched target verification and sequential signing; failures drain active restores or inspections without retries.
 */
export function signWindowsCode(root: string, options: WindowsCodeSigningOptions): Promise<void>

/**
 * Reject unsigned or invalid PE files in a completed directory.
 * @param root Materialized artifact directory.
 * @param inspect Public-key verifier.
 * @returns Resolves after all PE signatures are valid.
 */
export function verifyWindowsCode(root: string, inspect?: typeof inspectWindowsRuntimeSignature): Promise<void>

/** Pinned self-signed report. UnknownError is not acceptance by itself. */
export interface WindowsSelfSignedSignature {
  status: string
  thumbprint: string | null
  timestampValid: boolean
  genTime: string | null
}

/**
 * Read a self-signed Authenticode report, including the RFC 3161 token result.
 * @param path File to inspect.
 * @returns Status, signer thumbprint, and token result. Does not require a trusted root.
 */
export function inspectWindowsSelfSignedSignature(path: string): Promise<WindowsSelfSignedSignature>

/**
 * Sign unsigned files with the self-signed hook. A Valid signature is accepted as an upstream binary.
 * UnknownError passes only for the pinned certificate and a verified RFC 3161 token.
 * Does not change the eToken requirement that signWindowsCode accept only Valid.
 * @param root Owned final runtime directory.
 * @param options Self-sign hook and pinned certificate thumbprint.
 * @returns Resolves after every discovered PE passes pinned verification.
 */
export function signWindowsSelfSignedCode(root: string, options: {
  thumbprint: string
  sign: (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>
  record: (event: object) => void
  inspect?: typeof inspectWindowsSelfSignedSignature
}): Promise<void>

/**
 * Reject any PE that is not a chain-trusted signature or a pinned self-signed signature with a verified RFC 3161 token.
 * @param root Materialized artifact directory.
 * @param options Pinned certificate thumbprint and optional inspector.
 * @returns Resolves after every discovered PE passes pinned verification.
 */
export function verifyWindowsSelfSignedCode(root: string, options: {
  thumbprint: string
  inspect?: typeof inspectWindowsSelfSignedSignature
}): Promise<void>
