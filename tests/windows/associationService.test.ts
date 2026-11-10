import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../../src/main/application/errors'
import { SettingsStore } from '../../src/main/local-state/settings'
import { AssociationService } from '../../src/main/windows/associationService'
import {
    ASKED_KEY,
    ASKED_VALUE,
    EXT_KEY,
    FileAssociation
} from '../../src/main/windows/fileAssociation'
import { InMemoryRegistry } from '../../src/main/windows/inMemoryRegistry'

let dir: string
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bc-assoc-'))
})
afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
        () => undefined
    )
})

async function setup(
    seed: Record<string, Record<string, string>> = {},
    answer = true,
    supported = true
) {
    const settings = new SettingsStore(dir, () => 'p1')
    await settings.load()
    const registry = new InMemoryRegistry(seed)
    const asked: number[] = []
    const service = new AssociationService(
        supported
            ? new FileAssociation(registry, 'C:\\App\\BranchChat.exe', 'C:\\App\\d.ico')
            : null,
        settings,
        {
            confirmAssociation: () => {
                asked.push(1)
                return Promise.resolve(answer)
            }
        }
    )
    return { settings, registry, service, asked }
}

describe('AssociationService.offerAtStartup (FR-136)', () => {
    it('asks once on first start and registers on yes', async () => {
        const { service, asked, settings } = await setup()
        await service.offerAtStartup()
        expect(asked).toHaveLength(1)
        expect((await service.info()).state).toBe('on')
        expect(settings.get().associationAsked).toBe(true)
        await service.offerAtStartup()
        expect(asked).toHaveLength(1)
    })

    it('registers nothing on no, and does not ask again', async () => {
        const { service, asked, settings } = await setup({}, false)
        await service.offerAtStartup()
        expect((await service.info()).state).toBe('off')
        expect(settings.get().associationAsked).toBe(true)
        await service.offerAtStartup()
        expect(asked).toHaveLength(1)
    })

    it('does not ask if the installer already asked', async () => {
        const { service, asked } = await setup({ [ASKED_KEY]: { [ASKED_VALUE]: '1' } })
        await service.offerAtStartup()
        expect(asked).toHaveLength(0)
        expect((await service.info()).state).toBe('off')
    })

    it('does not ask if the type is already associated, with BranchChat or another program', async () => {
        for (const owner of ['BranchChat.Discussion', 'Other.App']) {
            const { service, asked, settings } = await setup({
                [EXT_KEY]: { '': owner },
                [`HKCU\\Software\\Classes\\${owner}\\shell\\open\\command`]: { '': 'app.exe "%1"' }
            })
            await service.offerAtStartup()
            expect(asked).toHaveLength(0)
            expect(settings.get().associationAsked).toBe(true)
            await rm(join(dir, 'settings.json'), { force: true })
        }
    })

    it('does nothing where the association cannot be managed', async () => {
        const { service, asked } = await setup({}, true, false)
        await service.offerAtStartup()
        expect(asked).toHaveLength(0)
        expect((await service.info()).state).toBe('unsupported')
    })
})

describe('AssociationService.set (FR-089, FR-138)', () => {
    it('turns the association on and off', async () => {
        const { service } = await setup()
        expect((await service.set(true)).state).toBe('on')
        expect((await service.set(false)).state).toBe('off')
    })

    it('is refused when another program holds the type', async () => {
        const { service } = await setup({
            [EXT_KEY]: { '': 'Other.App' },
            [`HKCU\\Software\\Classes\\Other.App\\shell\\open\\command`]: { '': 'other.exe "%1"' }
        })
        await expect(service.set(true)).rejects.toMatchObject({ code: 'ASSOCIATION_BLOCKED' })
    })

    it('reports unsupported platforms as an application error', async () => {
        const { service } = await setup({}, true, false)
        const err = await service.set(true).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(AppError)
        expect((err as AppError).code).toBe('ASSOCIATION_UNSUPPORTED')
    })
})
