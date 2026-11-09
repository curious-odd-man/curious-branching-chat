import { describe, expect, it } from 'vitest'
import type { UpdateView } from '../../src/shared/types/ipc'
import { UpdateService } from '../../src/main/updates/updateService'
import type { AvailableRelease, UpdaterPort } from '../../src/main/updates/updaterPort'

class FakePort implements UpdaterPort {
  active = true
  release: AvailableRelease | null = null
  checkError: Error | null = null
  downloadError: Error | null = null
  installs = 0
  checks = 0
  downloads = 0
  pageBase: string | null = 'https://github.com/o/r/releases/tag/v'
  isActive(): boolean {
    return this.active
  }
  check(): Promise<AvailableRelease | null> {
    this.checks++
    return this.checkError ? Promise.reject(this.checkError) : Promise.resolve(this.release)
  }
  async download(onProgress: (p: number) => void): Promise<void> {
    this.downloads++
    onProgress(40)
    onProgress(120)
    if (this.downloadError) throw this.downloadError
  }
  quitAndInstall(): void {
    this.installs++
  }
  releasePageUrl(version: string): string | null {
    return this.pageBase ? `${this.pageBase}${version}` : null
  }
}

const RELEASE: AvailableRelease = {
  version: '0.2.0',
  releaseDate: '2026-11-01T10:00:00.000Z',
  notes:
    '<h2>Новое</h2><ul><li>Первое</li><li>Второе &amp; третье</li></ul><script>alert(1)</script>',
  sizeBytes: 90_000_000
}

function make(auto = true) {
  const port = new FakePort()
  const views: UpdateView[] = []
  const opened: string[] = []
  const service = new UpdateService({
    port,
    currentVersion: '0.1.0',
    publish: (v) => views.push(v),
    openLink: (url) => {
      opened.push(url)
      return Promise.resolve()
    },
    autoCheckEnabled: () => auto
  })
  return { port, service, views, opened }
}

describe('UpdateService: manual check (FR-096)', () => {
  it('reports the latest version when there is nothing newer, and opens the dialog', async () => {
    const { service, views } = make()
    await service.checkManually()
    expect(views.map((v) => v.phase)).toEqual(['checking', 'up-to-date'])
    expect(service.get()).toMatchObject({
      phase: 'up-to-date',
      dialogOpen: true,
      currentVersion: '0.1.0'
    })
  })

  it('shows version, date, size and plain-text notes of a newer release (FR-098)', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkManually()
    const s = service.get()
    expect(s.phase).toBe('available')
    expect(s.dialogOpen).toBe(true)
    expect(s.info).toEqual({
      version: '0.2.0',
      releaseDate: '2026-11-01T10:00:00.000Z',
      notes: 'Новое\n\n• Первое\n• Второе & третье',
      sizeBytes: 90_000_000,
      hasReleasePage: true
    })
    expect(JSON.stringify(s)).not.toContain('<script')
  })

  it('reports a failed check without a crash; the dialog can be closed (FR-105)', async () => {
    const { service, port } = make()
    port.checkError = new Error('getaddrinfo ENOTFOUND github.com')
    await service.checkManually()
    expect(service.get()).toMatchObject({
      phase: 'error',
      errorCode: 'UPDATE_CHECK_FAILED',
      dialogOpen: true
    })
    service.dismissDialog()
    expect(service.get()).toMatchObject({ phase: 'idle', errorCode: null, dialogOpen: false })
  })

  it('says so when updates are not available in this run (development)', async () => {
    const { service, port } = make()
    port.active = false
    await service.checkManually()
    expect(service.get()).toMatchObject({ phase: 'error', errorCode: 'UPDATE_NOT_SUPPORTED' })
    expect(port.checks).toBe(0)
  })
})

describe('UpdateService: automatic checks (FR-095, FR-097)', () => {
  it('finds an update silently: no dialog, only state for the banner', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkAutomatically()
    expect(service.get()).toMatchObject({ phase: 'available', dialogOpen: false })
    service.showDialog()
    expect(service.get().dialogOpen).toBe(true)
  })

  it('says nothing when up to date or when the check fails (offline)', async () => {
    const { service, port } = make()
    await service.checkAutomatically()
    expect(service.get()).toMatchObject({ phase: 'idle', dialogOpen: false, errorCode: null })
    port.checkError = new Error('offline')
    await service.checkAutomatically()
    expect(service.get()).toMatchObject({ phase: 'idle', dialogOpen: false, errorCode: null })
  })

  it('does nothing when switched off, or when not supported', async () => {
    const off = make(false)
    await off.service.checkAutomatically()
    expect(off.port.checks).toBe(0)
    const inactive = make()
    inactive.port.active = false
    await inactive.service.checkAutomatically()
    expect(inactive.port.checks).toBe(0)
  })

  it('does not search again while an update is already found or downloaded', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkAutomatically()
    await service.checkAutomatically()
    expect(port.checks).toBe(1)
  })

  it('a manual check right after an automatic find shows the found update without another search', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkAutomatically()
    await service.checkManually()
    expect(port.checks).toBe(1)
    expect(service.get()).toMatchObject({ phase: 'available', dialogOpen: true })
  })
})

describe('UpdateService: download and install (FR-100 to FR-106)', () => {
  it('downloads on request, reports progress within 0..100, then waits for the restart', async () => {
    const { service, port, views } = make()
    port.release = RELEASE
    await service.checkManually()
    await service.download()
    expect(views.filter((v) => v.phase === 'downloading').map((v) => v.percent)).toEqual([
      0, 40, 100
    ])
    expect(service.get().phase).toBe('ready')
    expect(port.installs).toBe(0) // nothing is installed until the person agrees
    service.install()
    expect(port.installs).toBe(1)
  })

  it('refuses to install when nothing was downloaded', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkManually()
    expect(() => service.install()).toThrow()
    expect(port.installs).toBe(0)
  })

  it('a download that fails verification is reported as such and never becomes installable (FR-102)', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkManually()
    port.downloadError = new Error('sha512 checksum mismatch, expected abc, got def')
    await service.download()
    expect(service.get()).toMatchObject({ phase: 'error', errorCode: 'UPDATE_VERIFY_FAILED' })
    expect(() => service.install()).toThrow()
    expect(port.installs).toBe(0)
  })

  it('a network failure during download can be retried (FR-105)', async () => {
    const { service, port } = make()
    port.release = RELEASE
    await service.checkManually()
    port.downloadError = new Error('ECONNRESET')
    await service.download()
    expect(service.get()).toMatchObject({ phase: 'error', errorCode: 'UPDATE_DOWNLOAD_FAILED' })
    port.downloadError = null
    await service.download()
    expect(service.get().phase).toBe('ready')
  })

  it('ignores a download request when no update was found', async () => {
    const { service, port } = make()
    await service.download()
    expect(port.downloads).toBe(0)
  })
})

describe('UpdateService: release page (FR-099)', () => {
  it('opens the page built from the release version, never an address from the window', async () => {
    const { service, port, opened } = make()
    port.release = RELEASE
    await service.checkManually()
    expect(await service.openReleasePage()).toBe(true)
    expect(opened).toEqual(['https://github.com/o/r/releases/tag/v0.2.0'])
  })

  it('does nothing when the repository is unknown or no update is shown', async () => {
    const { service, port, opened } = make()
    expect(await service.openReleasePage()).toBe(false)
    port.release = RELEASE
    port.pageBase = null
    await service.checkManually()
    expect(service.get().info?.hasReleasePage).toBe(false)
    expect(await service.openReleasePage()).toBe(false)
    expect(opened).toEqual([])
  })
})
