import type { SettingsView } from '@shared/types/ipc'
import type { ReinviteTarget } from './candidates'
import { CreateWizard } from './CreateWizard'
import { InviteWizard } from './InviteWizard'
import { JoinWizard } from './JoinWizard'

export type { ReinviteTarget } from './candidates'
export { RosterDialog } from './roster'

export type WizardMode = 'new' | 'convert' | 'join' | 'invite' | 'reinvite'

interface Props {
    mode: WizardMode
    settings: SettingsView | undefined
    onClose(): void
    /** For `reinvite`. */
    target?: ReinviteTarget
}

/**
 * Wizards of synchronized discussions (design 12.3 to 12.5, FR-158, FR-162): create, convert the open discussion, join
 * by invitation, or invite. One component per mode (code review 4.4). The person checks every fingerprint; private
 * keys never leave this computer.
 */
export function SharedWizard({ mode, settings, onClose, target }: Props): React.JSX.Element {
    if (mode === 'join') return <JoinWizard settings={settings} onClose={onClose} />
    if (mode === 'invite' || mode === 'reinvite')
        return <InviteWizard mode={mode} settings={settings} target={target} onClose={onClose} />
    return <CreateWizard mode={mode} settings={settings} onClose={onClose} />
}
