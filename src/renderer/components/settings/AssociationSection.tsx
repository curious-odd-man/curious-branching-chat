import { useEffect, useState } from 'react'
import { texts } from '@shared/i18n'
import type { AssociationInfo } from '@shared/types/ipc'
import { useApi } from '../../api'
import type { SectionProps } from './types'

const stateText = (state: 'on' | 'off' | 'other-app' | 'unsupported'): string =>
    ({
        on: texts().association.stateOn,
        off: texts().association.stateOff,
        'other-app': texts().association.stateOther,
        unsupported: texts().association.stateUnsupported
    })[state]

/** The .branchchat file association (FR-089, FR-138). */
export function AssociationSection({
    run,
    setError
}: Pick<SectionProps, 'run' | 'setError'>): React.JSX.Element {
    const api = useApi()
    const [association, setAssociation] = useState<AssociationInfo | null>(null)
    // The value being applied, shown right away while the change is written.
    const [requested, setRequested] = useState<boolean | null>(null)

    useEffect(() => {
        void api.getAssociation().then((r) => r.ok && setAssociation(r.data))
    }, [api])

    const toggle = (enabled: boolean): void => {
        setRequested(enabled)
        setError(null)
        void run(
            () => api.setAssociation(enabled),
            setAssociation,
            () => void api.getAssociation().then((s) => s.ok && setAssociation(s.data))
        ).finally(() => setRequested(null))
    }

    const state = association?.state
    const canToggle = state === 'on' || state === 'off'
    return (
        <section>
            <h3>{texts().association.heading}</h3>
            <label className="check">
                <input
                    type="checkbox"
                    data-testid="settings-association"
                    checked={requested ?? state === 'on'}
                    disabled={!canToggle || requested !== null}
                    onChange={(e) => toggle(e.target.checked)}
                />
                <span>{texts().association.checkbox}</span>
            </label>
            <p className="hint">{texts().association.explanation}</p>
            {state && (
                <p className="hint" data-testid="settings-association-state" data-state={state}>
                    {stateText(state)}
                </p>
            )}
        </section>
    )
}
