import { BrowserWindow, type Input, type WebContents } from 'electron'
import { nextTextSize, zoomKeyOfEvent } from '@shared/shortcuts'
import type { SettingsView } from '@shared/types/ipc'

export type ZoomDirection = 'in' | 'out' | 'reset'

/**
 * Which zoom action a key press asks for (FR-301): Ctrl with plus, equals, minus, or zero, also on the keypad. Used for
 * real key presses in the main process and by the page (`zoomKeyOfEvent`) for keys that do not pass the main process.
 */
export function zoomKey(
    input: Pick<Input, 'type' | 'control' | 'meta' | 'alt' | 'key' | 'code'>
): ZoomDirection | null {
    if (input.type !== 'keyDown') return null
    return zoomKeyOfEvent({
        ctrlKey: input.control,
        metaKey: input.meta,
        altKey: input.alt,
        key: input.key,
        code: input.code
    })
}

export interface ZoomDeps {
    current(): number
    save(percent: number): Promise<SettingsView>
    /** Tells every window about the new settings (the Settings dialog shows the size). */
    publish(view: SettingsView): void
}

/**
 * FR-301, FR-302: one text size for every window, kept in the settings. Keys and Ctrl+mouse wheel go through here, so
 * the steps are always 10 % and the range is 80–200 %.
 */
export class ZoomService {
    constructor(private readonly deps: ZoomDeps) {}

    /** Called for every new web contents of a window. */
    attach(contents: WebContents): void {
        const apply = (): void => {
            if (!contents.isDestroyed()) contents.setZoomFactor(this.deps.current() / 100)
        }
        contents.on('did-finish-load', apply)
        contents.on('before-input-event', (event, input) => {
            const direction = zoomKey(input)
            if (!direction) return
            event.preventDefault()
            void this.change(direction)
        })
        // Ctrl + mouse wheel is handled by the page (one step per wheel notch); if Chromium changes the zoom by
        // itself, the saved size is put back
        contents.on('zoom-changed', apply)
    }

    async change(direction: ZoomDirection): Promise<void> {
        await this.set(nextTextSize(this.deps.current(), direction))
    }

    async set(percent: number): Promise<SettingsView> {
        const view = await this.deps.save(percent)
        for (const win of BrowserWindow.getAllWindows())
            if (!win.isDestroyed()) win.webContents.setZoomFactor(view.textSize / 100)
        this.deps.publish(view)
        return view
    }
}
