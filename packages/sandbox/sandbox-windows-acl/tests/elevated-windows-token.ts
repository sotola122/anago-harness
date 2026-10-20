import { execFileSync } from 'node:child_process'

/** Mandatory label RID for High integrity. System is higher. */
const HIGH_INTEGRITY_RID = 12_288

/**
 * Report whether this process token is High integrity or above.
 *
 * GitHub-hosted `windows-latest` runs as the built-in Administrator at High
 * integrity (`S-1-16-12288`). That token keeps `WRITE_DAC` and `WRITE_OWNER`
 * through the enabled Administrators group after a fixture narrows the user
 * ACE to Modify, and `FILE_FLAG_BACKUP_SEMANTICS` with the enabled backup
 * privilege lets `GENERIC_ALL` open a directory whose `FILE_DELETE_CHILD`
 * deny stops a Medium token. Cases that observe those Medium-token results
 * skip when this returns true. A Medium token still runs them.
 * @returns True on Windows when the mandatory label is High or System.
 */
export function elevatedWindowsToken(): boolean {
  if (process.platform !== 'win32') return false
  let output: string
  try {
    output = execFileSync('whoami', ['/groups', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000,
    })
  } catch (error) {
    // A missing whoami leaves the cases enabled so a probe failure stays visible.
    void error
    return false
  }
  const level = /S-1-16-(\d+)/u.exec(output)?.[1]
  return level !== undefined && Number(level) >= HIGH_INTEGRITY_RID
}
