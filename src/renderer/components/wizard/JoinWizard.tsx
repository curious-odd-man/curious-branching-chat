import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import type { InvitationView, SettingsView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { AutoStartNote, FolderStep, InvitationStep, WizardFrame } from './steps'
import { POLL_MS, useFolderChoice, usePublishedKey, useWizardBase } from './useWizard'

/** Join a synchronized discussion by invitation (design 12.5): the invitation is looked for until it is there. */
export function JoinWizard({
    settings,
    onClose
}: {
    settings: SettingsView | undefined
    onClose(): void
}): React.JSX.Element {
    const api = useApi()
    const base = useWizardBase(settings)
    const { ready, setError } = base
    const { folder, root, choose } = useFolderChoice(base)
    const [invitation, setInvitation] = useState<InvitationView | null>(null)
    usePublishedKey(base, root)

    useEffect(() => {
        if (!root || !ready) return
        let stopped = false
        const look = (): void => {
            void api.findInvitation(root).then((r) => {
                if (stopped) return
                if (r.ok) setInvitation(r.data)
                else setError(r.error.message)
            })
        }
        look()
        const timer = setInterval(look, POLL_MS)
        return () => {
            stopped = true
            clearInterval(timer)
        }
    }, [api, root, ready, setError])

    const join = (): void => {
        if (!root || invitation?.state !== 'ready') return
        setError(null)
        void base.run(
            () => api.importInvitation(root, invitation.invitationId),
            (joined) => {
                if (joined) onClose()
            }
        )
    }

    return (
        <WizardFrame
            base={base}
            mode="join"
            title={texts().shared.joinTitle}
            intro={texts().shared.intro}
            head={<AutoStartNote show={!!settings && !settings.startWithWindowsSettled} />}
            onClose={onClose}
            action={
                <button
                    type="button"
                    className="primary"
                    data-testid="wizard-join"
                    disabled={base.busy || invitation?.state !== 'ready'}
                    onClick={join}
                >
                    {texts().shared.joinAccept}
                </button>
            }
        >
            <FolderStep folder={folder} ready={ready} onChoose={choose} />
            {root && <InvitationStep invitation={invitation} />}
        </WizardFrame>
    )
}
