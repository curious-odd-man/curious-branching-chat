import { CancellationToken, NsisUpdater, type UpdateInfo } from 'electron-updater'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseFeedRepo, releasePageUrl } from './feedRepo'
import type { AvailableRelease, UpdaterPort } from './updaterPort'

export interface ElectronUpdaterOptions {
  /** Test builds only: read releases from this folder URL instead of GitHub (generic provider). */
  testFeedUrl?: string
  /** Test builds only: a config file standing in for the `app-update.yml` of an installed application. */
  testConfigPath?: string
  /** Test builds only: do not run the installer; call this instead. */
  onTestInstall?: () => void
  /** Test builds only: the repository shown as the release page. */
  testRepo?: { owner: string; repo: string }
}

function sizeOf(info: UpdateInfo): number | null {
  const file = info.files.find((f) => f.url.toLowerCase().endsWith('.exe')) ?? info.files[0]
  return typeof file?.size === 'number' ? file.size : null
}

/**
 * electron-updater with the GitHub provider (ADR section 9):
 * - stable releases only: prereleases and drafts are ignored, and downgrades are refused (FR-094);
 * - the download is verified against the SHA-512 in `latest.yml`; a mismatch is an error and nothing is installed
 *   (FR-101, FR-102);
 * - nothing is downloaded until the person asks, and the installer runs only when the application is closed
 *   (FR-106); a downloaded update is also installed silently when the application is next closed normally;
 * - no custom request headers are set, so a request carries nothing about documents or people (NFR-008).
 */
export class ElectronUpdaterPort implements UpdaterPort {
  private readonly updater: NsisUpdater
  private repo: { owner: string; repo: string } | null
  private readonly onTestInstall: (() => void) | undefined

  constructor(options: ElectronUpdaterOptions = {}) {
    // The GitHub provider and its settings come from the `app-update.yml` that electron-builder writes into the
    // installed application; test builds supply a local feed instead.
    this.updater = new NsisUpdater(
      options.testFeedUrl ? { provider: 'generic', url: options.testFeedUrl } : undefined
    )
    this.updater.autoDownload = false
    this.updater.autoInstallOnAppQuit = true
    this.updater.autoRunAppAfterInstall = true
    this.updater.allowPrerelease = false
    this.updater.allowDowngrade = false
    this.updater.disableWebInstaller = true
    if (options.testFeedUrl) this.updater.forceDevUpdateConfig = true
    if (options.testConfigPath) this.updater.updateConfigPath = options.testConfigPath
    this.onTestInstall = options.onTestInstall
    this.repo = options.testRepo ?? null
    if (!this.repo) void this.loadRepo()
  }

  private async loadRepo(): Promise<void> {
    try {
      const yaml = await fs.readFile(join(process.resourcesPath, 'app-update.yml'), 'utf8')
      this.repo = parseFeedRepo(yaml)
    } catch {
      this.repo = null
    }
  }

  isActive(): boolean {
    return this.updater.isUpdaterActive()
  }

  async check(): Promise<AvailableRelease | null> {
    const result = await this.updater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) return null
    const info = result.updateInfo
    return {
      version: info.version,
      releaseDate: info.releaseDate ?? null,
      notes: info.releaseNotes ?? null,
      sizeBytes: sizeOf(info)
    }
  }

  async download(onProgress: (percent: number) => void): Promise<void> {
    const listener = (p: { percent: number }): void => onProgress(p.percent)
    this.updater.on('download-progress', listener)
    try {
      // electron-updater compares the file's SHA-512 with latest.yml and rejects on a mismatch.
      await this.updater.downloadUpdate(new CancellationToken())
    } finally {
      this.updater.removeListener('download-progress', listener)
    }
  }

  quitAndInstall(): void {
    if (this.onTestInstall) return this.onTestInstall()
    // Silent, so the installer shows no pages and leaves the file association as the person chose it (FR-135).
    this.updater.quitAndInstall(true, true)
  }

  releasePageUrl(version: string): string | null {
    return this.repo ? releasePageUrl(this.repo, version) : null
  }
}

export const isPackagedApp = (): boolean => app.isPackaged
