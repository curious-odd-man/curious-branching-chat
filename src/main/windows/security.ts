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
    session.defaultSession.setPermissionCheckHandler(() => false)
    session.defaultSession.setDevicePermissionHandler(() => false)

    // The windows never fetch anything from the network (ADR 7.2: never fetch remote content). The content security
    // policy already forbids it; this refuses any http(s) or websocket request from a window as a second layer. The
    // update check runs in the main process, in its own network session, and is not affected. Only the development
    // server (npm run dev) is let through.
    const devOrigin = process.env['ELECTRON_RENDERER_URL']
        ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
        : null
    session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) => {
            const origin = (() => {
                try {
                    return new URL(details.url.replace(/^ws/, 'http')).origin
                } catch {
                    return null
                }
            })()
            callback({ cancel: !(devOrigin && origin === devOrigin) })
        }
    )

    app.on('web-contents-created', (_event, contents) => {
        // Never navigate away from the app, never open new windows, never attach webviews.
        contents.on('will-navigate', (event) => event.preventDefault())
        contents.on('will-redirect', (event) => event.preventDefault())
        contents.on('will-attach-webview', (event) => event.preventDefault())
        contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })
}
