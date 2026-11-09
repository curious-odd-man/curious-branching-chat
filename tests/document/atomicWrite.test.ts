import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentError, writeFileAtomically } from '../../src/main/document'
import { withTempDir } from '../helpers/fixtures'

const noSleep = async (): Promise<void> => undefined

describe('writeFileAtomically (FR-013)', () => {
    it('replaces the target with the new content', async () => {
        await withTempDir(async (dir) => {
            const target = join(dir, 'a.branchchat')
            await fs.writeFile(target, 'old')
            await writeFileAtomically(target, (tmp) => fs.writeFile(tmp, 'new'))
            expect(await fs.readFile(target, 'utf8')).toBe('new')
            expect(await fs.readdir(dir)).toEqual(['a.branchchat']) // no temp file left behind
        })
    })

    it('leaves the original untouched if writing fails midway', async () => {
        await withTempDir(async (dir) => {
            const target = join(dir, 'a.branchchat')
            await fs.writeFile(target, 'precious')
            await expect(
                writeFileAtomically(target, async (tmp) => {
                    await fs.writeFile(tmp, 'half-writ')
                    throw new Error('disk exploded')
                })
            ).rejects.toBeInstanceOf(DocumentError)
            expect(await fs.readFile(target, 'utf8')).toBe('precious')
            expect(await fs.readdir(dir)).toEqual(['a.branchchat'])
        })
    })

    it('simulated crash before the rename: the original is intact', async () => {
        await withTempDir(async (dir) => {
            const target = join(dir, 'a.branchchat')
            await fs.writeFile(target, 'precious')
            await expect(
                writeFileAtomically(target, (tmp) => fs.writeFile(tmp, 'complete new content'), {
                    rename: async () => {
                        throw Object.assign(new Error('killed'), { code: 'EIO' })
                    }
                })
            ).rejects.toBeInstanceOf(DocumentError)
            expect(await fs.readFile(target, 'utf8')).toBe('precious')
        })
    })

    it('retries when Windows briefly locks the file (EPERM/EBUSY)', async () => {
        await withTempDir(async (dir) => {
            const target = join(dir, 'a.branchchat')
            await fs.writeFile(target, 'old')
            let calls = 0
            await writeFileAtomically(target, (tmp) => fs.writeFile(tmp, 'new'), {
                sleep: noSleep,
                rename: async (from, to) => {
                    if (++calls < 3)
                        throw Object.assign(new Error('locked'), {
                            code: calls === 1 ? 'EPERM' : 'EBUSY'
                        })
                    await fs.rename(from, to)
                }
            })
            expect(calls).toBe(3)
            expect(await fs.readFile(target, 'utf8')).toBe('new')
        })
    })

    it('gives up with ACCESS_DENIED after the last retry and keeps the original', async () => {
        await withTempDir(async (dir) => {
            const target = join(dir, 'a.branchchat')
            await fs.writeFile(target, 'old')
            const err = await writeFileAtomically(target, (tmp) => fs.writeFile(tmp, 'new'), {
                sleep: noSleep,
                retryDelaysMs: [1, 1],
                rename: async () => {
                    throw Object.assign(new Error('locked'), { code: 'EPERM' })
                }
            }).catch((e: unknown) => e)
            expect((err as DocumentError).code).toBe('ACCESS_DENIED')
            expect(await fs.readFile(target, 'utf8')).toBe('old')
            expect(await fs.readdir(dir)).toEqual(['a.branchchat'])
        })
    })
})
