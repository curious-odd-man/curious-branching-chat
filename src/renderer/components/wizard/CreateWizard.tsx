import { useState } from 'react'
import { texts } from '@shared/i18n'
import type { SettingsView } from '@shared/types/ipc'
import { useApi } from '../../api'
import { acceptedKeys } from './candidates'
import { RosterScreen } from './roster'
import { AutoStartNote, FolderStep, MembersStep, WizardFrame } from './steps'
import { useCandidates, useFolderChoice, useRosterAfterDone, useWizardBase } from './useWizard'

/** Create a synchronized discussion, or convert the open one (design 12.3, FR-158, FR-162). */
export function CreateWizard({
    mode,
    settings,
    onClose
}: {
    mode: 'new' | 'convert'
    settings: SettingsView | undefined
    onClose(): void
}): React.JSX.Element {
    const api = useApi()
    const base = useWizardBase(settings)
    const { folder, root, choose } = useFolderChoice(base)
    const { state, dispatch, refresh } = useCandidates(base, root)
    const { roster, showRoster } = useRosterAfterDone()
    const [title, setTitle] = useState<string>(texts().shared.defaultFileName)

    if (roster) return <RosterScreen roster={roster} onClose={onClose} />

    const create = (): void => {
        if (!root) return
        base.setError(null)
        void base.run(
            () =>
                api.createShared(
                    root,
                    acceptedKeys(state.candidates, state),
                    mode,
                    mode === 'convert' ? undefined : title.trim()
                ),
            async (created) => {
                if (created) await showRoster(onClose)
            }
        )
    }

    return (
        <WizardFrame
            base={base}
            mode={mode}
            title={mode === 'new' ? texts().shared.newTitle : texts().shared.convertTitle}
            intro={texts().shared.intro}
            head={<AutoStartNote show={!!settings && !settings.startWithWindowsSettled} />}
            onClose={onClose}
            action={
                <button
                    type="button"
                    className="primary"
                    data-testid="wizard-create"
                    disabled={
                        base.busy ||
                        !root ||
                        !base.ready ||
                        state.accepted.size === 0 ||
                        (mode !== 'convert' && title.trim().length === 0)
                    }
                    onClick={create}
                >
                    {mode === 'convert' ? texts().shared.convert : texts().shared.create}
                </button>
            }
        >
            {mode === 'new' && (
                <section>
                    <label>
                        {texts().shared.titleLabel}
                        <input
                            data-testid="wizard-title"
                            maxLength={500}
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </label>
                </section>
            )}
            <FolderStep folder={folder} ready={base.ready} onChoose={choose} />
            {root && (
                <MembersStep
                    base={base}
                    shown={state.candidates}
                    state={state}
                    dispatch={dispatch}
                    onRefresh={refresh}
                    onAdd={(candidate) => dispatch({ type: 'add', candidate })}
                />
            )}
        </WizardFrame>
    )
}
