import type { SettingsView } from '@shared/types/ipc'
import type { IpcRun } from '../../api'

/** What each section of the Settings dialog gets (code review 4.4). The dialog shows one error line for all. */
export interface SectionProps {
    settings: SettingsView | undefined
    run: IpcRun
    setError(error: string | null): void
    onSettingsChanged(settings: SettingsView): void
}
