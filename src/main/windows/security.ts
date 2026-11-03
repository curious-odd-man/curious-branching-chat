import { app, session, shell } from 'electron'
import { isAllowedLinkHref } from '@shared/validation'

/** Opens a link only if its protocol is allowed (http, https, mailto) — NFR-014. Call only after an explicit user action. */
export async function openExternalLink(url: string): Promise<boolean> {
  if (!isAllowedLinkHref(url)) return false
  await shell.openExternal(url)
  return true
}

/** Process-wide hardening (ADR section 7.1). Call once, before any window is created. */
export function applyGlobalSecurity(): void {
  // No permission prompts: the app needs no camera, microphone, geolocation, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false)
  )

  app.on('web-contents-created', (_event, contents) => {
    // Never navigate away from the app, never open new windows, never attach webviews.
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}
