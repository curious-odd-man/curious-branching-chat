import type { TrayItem } from './trayMenu'

/** The notification-area icon (Electron `Tray` in the app; a recorder in test builds). */
export interface TrayPort {
    /** Shows the icon (if not shown yet) with this menu. */
    show(items: readonly TrayItem[], onAction: (id: string) => void, onClick: () => void): void
    hide(): void
}

export interface NotificationRequest {
    title: string
    body: string
    onClick: () => void
}

/** Windows notifications (Electron `Notification`; a recorder in test builds). */
export interface NotifierPort {
    show(request: NotificationRequest): void
}

/** "Запускать вместе с Windows" (Electron login item settings; a recorder in test builds). */
export interface LoginItemPort {
    set(enabled: boolean): void
}

/** The argument that starts the app in the tray, with no window (FR-174). */
export const BACKGROUND_ARG = '--background'
