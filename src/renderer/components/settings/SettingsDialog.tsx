import { texts } from '@shared/i18n'
import type { SettingsView } from '@shared/types/ipc'
import { useApi, useIpcAction } from '../../api'
import { Modal } from '../Modal'
import { NumberField } from './NumberField'
import { AssociationSection } from './AssociationSection'
import { BackgroundSection } from './BackgroundSection'
import { BackupSection } from './BackupSection'
import { IdentitySection } from './IdentitySection'
import { LanguageSection } from './LanguageSection'
import { NameSection } from './NameSection'
import { StartupSection } from './StartupSection'
import { TextSizeSection } from './TextSizeSection'
import { UpdatesSection } from './UpdatesSection'

interface Props {
    settings: SettingsView | undefined
    onNameSaved(settings: SettingsView): void
    onSettingsChanged(settings: SettingsView): void
    onClose(): void
    /** "Восстановить из резервной копии…" (FR-207). */
    onRestore(): void
}

/**
 * File > Settings…: one section per subject (code review 4.4). All sections show their errors in one line at the end.
 */
export function SettingsDialog({
    settings,
    onNameSaved,
    onSettingsChanged,
    onClose,
    onRestore
}: Props): React.JSX.Element {
    const api = useApi()
    const { error, setError, run } = useIpcAction()
    const common = { settings, run, setError, onSettingsChanged }

    return (
        <Modal labelledBy="settings-title" onEscape={onClose}>
            <div className="dialog settings" data-testid="settings-dialog">
                <h2 id="settings-title">{texts().settings.title}</h2>
                <NameSection {...common} onNameSaved={onNameSaved} />
                <IdentitySection {...common} />
                <section>
                    <h3>{texts().attachments.heading}</h3>
                    {/* FR-265: "Наибольший размер вложения" */}
                    <NumberField
                        testId="settings-attachment-limit"
                        label={texts().attachments.limitLabel}
                        min={1}
                        max={1000}
                        value={settings?.attachmentLimitMb}
                        fallback={100}
                        onApply={(mb) =>
                            void run(() => api.setAttachmentLimit(mb), onSettingsChanged)
                        }
                    />
                    <p className="hint">{texts().attachments.limitHint}</p>
                </section>
                <AssociationSection run={run} setError={setError} />
                <BackgroundSection {...common} />
                <LanguageSection {...common} />
                <TextSizeSection {...common} />
                <StartupSection {...common} />
                <BackupSection {...common} onRestore={onRestore} />
                <UpdatesSection {...common} onClose={onClose} />

                {error && (
                    <p className="error-text" role="alert" data-testid="settings-error">
                        {error}
                    </p>
                )}
                <div className="buttons">
                    <button
                        type="button"
                        className="primary"
                        data-testid="settings-close"
                        autoFocus
                        onClick={onClose}
                    >
                        {texts().settings.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
