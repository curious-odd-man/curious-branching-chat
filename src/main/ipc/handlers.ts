import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { ZodError, type ZodType } from 'zod'
import { DomainError } from '@shared/domain'
import { describeError } from '@shared/i18n/ru'
import { IPC, type IpcResult } from '@shared/types/ipc'
import {
  appendMessageSchema,
  draftSchema,
  noPayloadSchema,
  openLinkSchema,
  openPathSchema,
  setNameSchema
} from '@shared/validation'
import type { AppController, WindowEntry } from '../application/appController'
import { AppError } from '../application/errors'
import { DocumentError } from '../document'
import { openExternalLink } from '../windows/security'
import type { SettingsStore } from '../local-state/settings'

function toError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError || err instanceof DocumentError || err instanceof DomainError)
    return {
      code: err.code,
      message: err instanceof DomainError ? err.message : describeError(err.code)
    }
  if (err instanceof ZodError) return { code: 'INVALID_REQUEST', message: 'Invalid request.' }
  return { code: 'UNKNOWN', message: describeError('UNKNOWN') }
}

/** Every channel validates its payload and its sender; the renderer is never trusted. */
export function registerIpcHandlers(controller: AppController, settings: SettingsStore): void {
  function handle<P, R>(
    channel: string,
    schema: ZodType<P>,
    fn: (entry: WindowEntry | undefined, payload: P, event: IpcMainInvokeEvent) => Promise<R> | R
  ): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<R>> => {
      try {
        if (event.senderFrame !== event.sender.mainFrame)
          throw new AppError('FORBIDDEN', 'Forbidden')
        const payload = schema.parse(raw)
        return { ok: true, data: await fn(controller.entryFor(event.sender), payload, event) }
      } catch (err) {
        return { ok: false, error: toError(err) }
      }
    })
  }

  const requireSession = (entry: WindowEntry | undefined) => {
    if (!entry?.session) throw new AppError('NO_DOCUMENT', 'No open discussion')
    return entry.session
  }

  handle(IPC.appInfo, noPayloadSchema, () => ({ name: app.getName(), version: app.getVersion() }))
  handle(IPC.settingsGet, noPayloadSchema, () => settings.get())
  handle(IPC.settingsSetName, setNameSchema, (_e, p) => settings.setDisplayName(p.displayName))

  handle(IPC.documentNew, noPayloadSchema, (entry) => controller.newDocument(entry))
  handle(IPC.documentOpenDialog, noPayloadSchema, (entry) => controller.openWithDialog(entry))
  handle(IPC.documentOpenPath, openPathSchema, (entry, p) => controller.openPath(p.path, entry))
  handle(IPC.documentGetState, noPayloadSchema, (entry) =>
    entry ? controller.viewOf(entry) : null
  )

  handle(IPC.documentAppendMessage, appendMessageSchema, (entry, p) => {
    const session = requireSession(entry)
    const me = settings.get()
    if (!me.displayName) throw new AppError('NAME_REQUIRED', 'Name required')
    session.appendMessage(
      { participantId: me.participantId, displayName: me.displayName },
      p.threadId,
      p.content
    )
  })
  handle(IPC.documentRetrySave, noPayloadSchema, async (entry) => {
    await requireSession(entry).retrySave()
  })
  handle(IPC.linkOpen, openLinkSchema, (_entry, p) => openExternalLink(p.url))
  handle(IPC.draftSet, draftSchema, (entry, p) => {
    if (entry) entry.hasDraft = p.hasDraft
  })
}
