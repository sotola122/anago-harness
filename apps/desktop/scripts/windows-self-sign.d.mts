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
 * @returns Serialized signing hook for the files electron-builder and the runtime PE walk do not sign themselves.
 */
export function createWindowsSelfSigner(options: {
  environment: NodeJS.ProcessEnv
  pfxFile: string
  password: string
}): (configuration: { path: string, hash: string, isNest: boolean }) => Promise<void>
