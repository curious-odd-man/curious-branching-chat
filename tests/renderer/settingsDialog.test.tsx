// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from '../../src/renderer/components/settings/SettingsDialog'
import { fail, fakeApi, installDomStubs, ok, renderWithApi, SETTINGS } from './helpers/fakeApi'

installDomStubs()

const open = (overrides: Parameters<typeof fakeApi>[0] = {}, settings = SETTINGS) => {
    const fake = fakeApi({
        getIdentity: () => ok({ state: 'ready', fingerprint: 'AAAA BBBB', replaced: null }),
        getAssociation: () => ok({ state: 'off' }),
        getBackups: () => ok({ lastBackupAt: null, folder: null, backups: [] }),
        ...overrides
    })
    const changed = vi.fn()
    const saved = vi.fn()
    renderWithApi(
        <SettingsDialog
            settings={settings}
            onNameSaved={saved}
            onSettingsChanged={changed}
            onClose={() => undefined}
            onRestore={() => undefined}
        />,
        fake.api
    )
    return { ...fake, changed, saved }
}

describe('Settings dialog (code review TS-1)', () => {
    it('saves a new name and says so', async () => {
        const { api, saved } = open({
            setDisplayName: (name: string) => ok({ ...SETTINGS, displayName: name })
        })
        fireEvent.change(screen.getByTestId('settings-name'), { target: { value: 'Борис' } })
        fireEvent.click(screen.getByTestId('settings-name-save'))
        await screen.findByTestId('settings-name-saved')
        expect(api.setDisplayName).toHaveBeenCalledWith('Борис')
        expect(saved).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Борис' }))
    })

    it('shows the fingerprint of the own key', async () => {
        open()
        expect((await screen.findByTestId('identity-fingerprint')).textContent).toBe('AAAA BBBB')
    })

    it('a size limit outside 5 to 1000 puts the old value back and is not sent', () => {
        const { api } = open()
        const field = screen.getByTestId<HTMLInputElement>('settings-size-limit')
        fireEvent.change(field, { target: { value: '4' } })
        fireEvent.blur(field)
        expect(field.value).toBe('30')
        expect(api.setFileSizeLimit).not.toHaveBeenCalled()
    })

    it('a valid size limit is sent on Enter', async () => {
        const { api, changed } = open({
            setFileSizeLimit: (mb: number) => ok({ ...SETTINGS, fileSizeLimitMb: mb })
        })
        const field = screen.getByTestId('settings-size-limit')
        fireEvent.change(field, { target: { value: '50' } })
        fireEvent.keyDown(field, { key: 'Enter' })
        await waitFor(() => expect(changed).toHaveBeenCalled())
        expect(api.setFileSizeLimit).toHaveBeenCalledWith(50)
    })

    it('a failed change of a flag puts the box back and shows the error in one line', async () => {
        open({ setBackgroundFlag: () => fail('Не удалось сохранить') })
        const box = screen.getByTestId<HTMLInputElement>('settings-notifyNewMessages')
        expect(box.checked).toBe(true)
        fireEvent.click(box)
        expect((await screen.findByTestId('settings-error')).textContent).toBe(
            'Не удалось сохранить'
        )
        expect(box.checked).toBe(true)
    })

    it('"back up now" is busy until the backup is done', async () => {
        let finish: (v: unknown) => void = () => undefined
        open({
            backupNow: () =>
                new Promise((resolve) => {
                    finish = resolve
                })
        })
        const button = screen.getByTestId<HTMLButtonElement>('backup-now')
        fireEvent.click(button)
        await waitFor(() => expect(button.disabled).toBe(true))
        finish({ ok: true, data: { createdAt: '2026-11-18T10:00:00.000Z', folderError: null } })
        await screen.findByTestId('backup-message')
        expect(button.disabled).toBe(false)
    })
})
