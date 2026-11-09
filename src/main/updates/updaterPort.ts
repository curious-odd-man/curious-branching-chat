/** An available release, as far as the updater knows it. Notes are raw (the service turns them into plain text). */
export interface AvailableRelease {
  version: string
  releaseDate: string | null
  notes: string | readonly { version?: string; note?: string | null }[] | null
  sizeBytes: number | null
}

/**
 * The part of an updater the application depends on. The real implementation wraps electron-updater; tests use a
 * fake. Implementations must verify the checksum of the download and throw (never resolve) if it does not match
 * (FR-101, FR-102), and must not send anything but the standard request for release metadata (NFR-008).
 */
export interface UpdaterPort {
  /** False when updates cannot work here (development run, no update configuration). */
  isActive(): boolean
  /** Resolves with the newer stable release, or null if the installed version is current. */
  check(): Promise<AvailableRelease | null>
  /** Downloads and verifies the update found by the last check. */
  download(onProgress: (percent: number) => void): Promise<void>
  /** Closes the application and runs the installer (FR-106). */
  quitAndInstall(): void
  /** The release page for a version (FR-099), or null if unknown. */
  releasePageUrl(version: string): string | null
}
