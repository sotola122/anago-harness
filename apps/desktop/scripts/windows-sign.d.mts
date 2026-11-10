/**
 * Build the minimal CMD environment for one Electron artifact.
 *
 * @param environment Parent environment.
 * @param input Validated signing identity and task.
 * @returns Scrubbed environment plus the fields consumed and cleared by the signing CMD.
 */
export function buildWindowsSigningEnvironment(environment: NodeJS.ProcessEnv, input: {
  certificateFile: string
  signTool: string
  path: string
  isNest: boolean
  tokenPin: string
  keyContainer: string
}): NodeJS.ProcessEnv

/**
 * Pin updater verification to the release certificate's organization, country, and common name.
 * @param certificateFile Public Windows Code Signing certificate file.
 * @returns Distinguished-name attributes consumed by electron-updater.
 */
export function resolveWindowsUpdatePublisher(certificateFile: string | undefined): string

/**
 * Serialize hardware-token signing and stop all queued tasks after the first failure.
 *
 * @param options Release signing configuration.
 * @returns The signing hook.
 */
export function createWindowsTokenSigner(options: {
  certificateFile?: string | undefined
  signTool?: string | undefined
  tokenPin?: string | undefined
  keyContainer?: string | undefined
  commandInterpreter?: string | undefined
  runDirectory?: string | undefined
  stateDirectory?: string | undefined
  preserveSignature?: (path: string) => Promise<boolean>
}): (
  configuration: {
    path: string
    hash: string
    isNest: boolean
  },
) => Promise<void>

/**
 * Remove inherited credentials before starting a signing-related subprocess.
 *
 * @param environment Parent environment.
 * @returns Environment without credential-shaped names.
 */
export function scrubWindowsSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv

/**
 * Replace a SignTool failure with a diagnostic that cannot retain its command line.
 *
 * @param error SignTool process failure.
 * @param path Artifact that failed signing.
 * @param secrets Values that must not appear in the diagnostic.
 * @returns Sanitized signing failure without the original error as its cause.
 */
export function createRedactedWindowsSigningError(
  error: unknown,
  path: string,
  secrets: readonly string[],
): Error

/**
 * Read whether SignTool can parse a file as a PE, without modifying it.
 * A missing or locked file is not parseable; that is a wait condition, not a defect.
 *
 * @param path Executable to inspect.
 * @returns Header facts. `dangling` is true only for a parseable PE whose certificate table points outside the file.
 */
export function inspectWindowsExecutableFormat(path: string): Promise<{
  size: number
  parseable: boolean
  reason: string
  dangling: boolean
}>

/**
 * Clear a certificate-table entry that points beyond the end of a generated executable.
 *
 * @param path Executable to inspect.
 * @returns Whether an invalid certificate-table entry was cleared.
 */
export function repairDanglingAuthenticodeDirectory(path: string): Promise<boolean>

/**
 * Sign electron-builder's temporary NSIS executable before enterprise code integrity evaluates it.
 *
 * @param options Signing hook and injectable host values.
 * @returns Nothing.
 */
export function installWindowsNsisBootstrapSigner(options: {
  sign: (configuration: {
    path: string
    hash: string
    isNest: boolean
  }) => Promise<void>
  wineVmManager?: {
    prototype: {
      exec: (
        file: string,
        args: string[],
        options?: { env?: NodeJS.ProcessEnv },
        isLogOutIfDebug?: boolean,
      ) => unknown
    }
  }
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
}): void
