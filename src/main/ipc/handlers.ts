import { ipcMain } from 'electron'
import { ZodError } from 'zod'
import { CodedError } from '@shared/errors'
import { describeError } from '@shared/i18n'
import type { IpcResult } from '@shared/types/ipc'
import { AppError } from '../application/errors'
import { registerAppHandlers } from './app'
import { registerAttachmentHandlers } from './attachments'
import { makeContext, type Handle, type IpcDeps } from './context'
import { registerDocumentHandlers } from './document'
import { registerLibraryHandlers } from './library'
import { registerSettingsHandlers } from './settings'
import { registerSharedHandlers } from './shared'

export type { IpcDeps } from './context'

/** Only the application's own page may call the main process: the packaged `file:` page, or the dev server. */
function isAppPage(url: string): boolean {
    const dev = process.env['ELECTRON_RENDERER_URL']
    return url.startsWith('file://') || (dev !== undefined && url.startsWith(dev))
}

/**
 * The error that the window gets: a code and the text of that code in the interface language. The internal message of
 * an error is never shown; an error without a code is written to the log, so the support report has it (FR-323).
 */
export function toError(
    err: unknown,
    log?: (message: string, err: unknown) => void,
    channel = ''
): { code: string; message: string } {
    if (err instanceof CodedError) return { code: err.code, message: describeError(err.code) }
    if (err instanceof ZodError)
        return { code: 'INVALID_REQUEST', message: describeError('INVALID_REQUEST') }
    log?.(`unexpected error in ${channel || 'a request'}`, err)
    return { code: 'UNKNOWN', message: describeError('UNKNOWN') }
}

/**
 * Every channel validates its payload and its sender; the renderer is never trusted. The channels are registered by
 * area, one module each.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
    const handle: Handle = (channel, schema, fn) => {
        ipcMain.handle(
            channel,
            async (event, raw: unknown): Promise<IpcResult<Awaited<ReturnType<typeof fn>>>> => {
                try {
                    if (
                        event.senderFrame !== event.sender.mainFrame ||
                        !isAppPage(event.senderFrame.url)
                    )
                        throw new AppError('FORBIDDEN', 'Forbidden')
                    const payload = schema.parse(raw)
                    return {
                        ok: true,
                        data: await fn(deps.controller.entryFor(event.sender), payload, event)
                    }
                } catch (err) {
                    return { ok: false, error: toError(err, deps.shared?.log, channel) }
                }
            }
        )
    }
    const ctx = makeContext(deps, handle)
    registerAppHandlers(ctx)
    registerSettingsHandlers(ctx)
    registerSharedHandlers(ctx)
    registerLibraryHandlers(ctx)
    registerDocumentHandlers(ctx)
    registerAttachmentHandlers(ctx)
}
