/** Public DER certificate committed beside the artifacts and used as the signing identity. */
export const ANAGO_SIGNING_CERTIFICATE: string

/**
 * Replace a signtool failure with a diagnostic that cannot retain the PFX password.
 * @param error Signing script failure.
 * @param path Artifact that failed signing.
 * @param secrets Values that must not appear in the diagnostic.
 * @param phase Whether the failure happened before SignTool ran.
 * @returns Sanitized signing failure without the original error as its cause.
 */
export function createWindowsSelfSigningError(
  error: unknown,
  path: string,
  secrets: readonly string[],
  phase?: 'sign' | 'preflight',
): Error

/**
 * Resolve the self-signed identity from packaging settings.
 * @param environment Packaging settings that name the PFX file and its password.
 * @returns Committed public identity plus the private PFX inputs.
 */
export function resolveWindowsSelfSignEnvironment(environment: NodeJS.ProcessEnv): {
  certificateFile: string
  thumbprint: string
  pfxFile: string
  password: string
}

/**
 * Create the hook that signs one executable with the self-signed PFX through the SDK signtool.
 * The first call loads Microsoft.PowerShell.Security from the interpreter before any file is signed. The password is not passed to that preflight.
 * @param options Packaging environment and validated PFX inputs.
 * @returns Serialized signing hook. The packager hook delegates electron-builder files here; beforeBuild and the runtime walk call it directly.
 */
export function createWindowsSelfSigner(options: {
  environment: NodeJS.ProcessEnv
  pfxFile: string
  password: string
}): (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>

/**
 * Sign electron-builder's Windows files with the self-signed hook.
 * The generated NSIS uninstaller is polled until it is a parseable PE, then a certificate table that points past the file is cleared.
 * If SignTool still rejects that stub, the hook records the reason and returns so the installer can still be signed.
 * Every other file is signed, or the hook throws. The wait is bounded.
 *
 * @param options Inner signer, journal callback, values that must not appear in the uninstaller record, and test timing.
 * @returns electron-builder `signtoolOptions.sign` hook.
 */
export function createWindowsSelfSignedPackagerSigner(options: {
  sign: (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>
  record?: (event: object) => void
  secrets?: readonly string[]
  uninstallerAttempts?: number
  sleep?: (ms: number) => Promise<void>
}): (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>
