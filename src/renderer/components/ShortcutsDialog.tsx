import { ru } from '@shared/i18n/ru'
import { SHORTCUT_GROUPS, SHORTCUTS } from '@shared/shortcuts'
import { Modal } from './Modal'

/** FR-311, FR-312: F1 and "Справка > Сочетания клавиш". Made from the same table that the menu and editor use. */
export function ShortcutsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
    return (
        <Modal labelledBy="shortcuts-title" onEscape={onClose}>
            <div className="dialog shortcuts" data-testid="shortcuts-dialog">
                <h2 id="shortcuts-title">{ru.shortcuts.title}</h2>
                {SHORTCUT_GROUPS.map((group) => (
                    <section key={group} data-testid="shortcuts-group" data-group={group}>
                        <h3>{ru.shortcuts.groups[group]}</h3>
                        <table>
                            <tbody>
                                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                                    <tr key={s.id} data-testid="shortcut" data-id={s.id}>
                                        <td>{ru.shortcuts.actions[s.id]}</td>
                                        <td>
                                            {s.keys.map((k, i) => (
                                                <span key={k}>
                                                    {i > 0 && ' / '}
                                                    <kbd>{k}</kbd>
                                                </span>
                                            ))}
                                        </td>
                                    </tr>
                                ))}
                                {group === 'window' && (
                                    <tr>
                                        <td colSpan={2} className="hint">
                                            {ru.shortcuts.wheel}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </section>
                ))}
                <div className="buttons">
                    <button type="button" className="primary" autoFocus onClick={onClose}>
                        {ru.shortcuts.close}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
