import { releaseNotesToText } from '@shared/domain'
import type { UpdateInfoView, UpdateView } from '@shared/types/ipc'
import { AppError } from '../application/errors'
import type { AvailableRelease, UpdaterPort } from './updaterPort'

function toInfoView(release: AvailableRelease, hasReleasePage: boolean): UpdateInfoView {
    return {
        version: release.version,
        releaseDate: release.releaseDate,
        notes: releaseNotesToText(release.notes),
        sizeBytes: release.sizeBytes,
        hasReleasePage
    }
}

/** A failed verification must be told apart from a network problem: the message differs. */
function downloadErrorCode(err: unknown): string {
    const text =
        err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ''}` : ''
    return /checksum|sha512|sha-512|integrity/i.test(text)
        ? 'UPDATE_VERIFY_FAILED'
        : 'UPDATE_DOWNLOAD_FAILED'
}

export interface UpdateServiceDeps {
    port: UpdaterPort
    currentVersion: string
    /** Called with every state change, to push it to the windows. */
    publish(view: UpdateView): void
    /** Called to open a web page in the system browser (only the release page is ever passed). */
    openLink(url: string): Promise<unknown>
    /** Reads the "check automatically" setting at the time of each automatic check (FR-097). */
    autoCheckEnabled(): boolean
    /** Writes a line for diagnosis. Never receives document or participant data. */
    log?(message: string): void
}

/**
 * The update flow: check (automatic or manual), show, download on request, install on restart (FR-093 to FR-106).
 * Failures never reach the rest of the application (FR-105): they only change the state shown in the update dialog.
 */
export class UpdateService {
    private state: UpdateView

    constructor(private readonly deps: UpdateServiceDeps) {
        this.state = {
            phase: 'idle',
            info: null,
            percent: 0,
            errorCode: null,
            dialogOpen: false,
            currentVersion: deps.currentVersion
        }
    }

    get(): UpdateView {
        return this.state
    }

    private set(patch: Partial<UpdateView>): void {
        this.state = { ...this.state, ...patch }
        this.deps.publish(this.state)
    }

    private get busy(): boolean {
        return this.state.phase === 'checking' || this.state.phase === 'downloading'
    }

    /** Help > Check for updates (FR-096): always answers, and opens the dialog. */
    async checkManually(): Promise<void> {
        if (this.busy || this.state.phase === 'ready') {
            this.set({ dialogOpen: true })
            return
        }
        if (!this.deps.port.isActive()) {
            this.set({
                phase: 'error',
                errorCode: 'UPDATE_NOT_SUPPORTED',
                info: null,
                dialogOpen: true
            })
            return
        }
        // Keep an already found update visible instead of searching again.
        if (this.state.phase === 'available') {
            this.set({ dialogOpen: true })
            return
        }
        this.set({ phase: 'checking', errorCode: null, info: null, dialogOpen: true })
        await this.runCheck(true)
    }

    /** The periodic and startup check (FR-095, FR-097): silent unless a new version is found. */
    async checkAutomatically(): Promise<void> {
        if (!this.deps.autoCheckEnabled() || !this.deps.port.isActive()) return
        if (this.busy || this.state.phase === 'ready' || this.state.phase === 'available') return
        this.set({ phase: 'checking', errorCode: null })
        await this.runCheck(false)
    }

    private async runCheck(manual: boolean): Promise<void> {
        try {
            const release = await this.deps.port.check()
            if (!release) {
                // Automatic: say nothing. Manual: tell the person that this is the latest version.
                this.set({ phase: manual ? 'up-to-date' : 'idle', info: null })
                return
            }
            const hasPage = this.deps.port.releasePageUrl(release.version) !== null
            this.set({ phase: 'available', info: toInfoView(release, hasPage), percent: 0 })
        } catch (err) {
            this.deps.log?.(
                `update check failed: ${err instanceof Error ? err.message : String(err)}`
            )
            // The application keeps working either way; only a manual check reports the problem.
            if (manual) this.set({ phase: 'error', errorCode: 'UPDATE_CHECK_FAILED', info: null })
            else this.set({ phase: 'idle', errorCode: null, info: null })
        }
    }

    /** The person pressed "Скачать". */
    async download(): Promise<void> {
        if (this.state.phase !== 'available' && this.state.phase !== 'error') return
        if (!this.state.info) return
        this.set({ phase: 'downloading', percent: 0, errorCode: null, dialogOpen: true })
        try {
            await this.deps.port.download((percent) => {
                if (this.state.phase === 'downloading')
                    this.set({ percent: Math.max(0, Math.min(100, percent)) })
            })
            this.set({ phase: 'ready', percent: 100 })
        } catch (err) {
            this.deps.log?.(
                `update download failed: ${err instanceof Error ? err.message : String(err)}`
            )
            // The previous version keeps running; the person may try again.
            this.set({ phase: 'error', errorCode: downloadErrorCode(err) })
        }
    }

    /** "Перезапустить и установить": the application closes and the installer replaces it (FR-106). */
    install(): void {
        if (this.state.phase !== 'ready')
            throw new AppError('INVALID_REQUEST', 'No update is ready')
        this.deps.port.quitAndInstall()
    }

    showDialog(): void {
        if (this.state.phase === 'idle') return
        this.set({ dialogOpen: true })
    }

    dismissDialog(): void {
        // A failure or "up to date" answer has been read; an available or downloaded update stays for the banner.
        const clear = this.state.phase === 'error' || this.state.phase === 'up-to-date'
        this.set({
            dialogOpen: false,
            ...(clear ? { phase: 'idle' as const, errorCode: null, info: null } : {})
        })
    }

    /** The release page for the update shown (FR-099). The address is built here; the window never supplies it. */
    async openReleasePage(): Promise<boolean> {
        const version = this.state.info?.version
        if (!version) return false
        const url = this.deps.port.releasePageUrl(version)
        if (!url) return false
        await this.deps.openLink(url)
        return true
    }
}
