import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { plainTextToRichDoc, mainThread } from '@shared/domain'
import { readDocument, writeDocument } from '../../src/main/document'
import { DocumentSession, type DocumentWriter } from '../../src/main/application/documentSession'
import { anna, boris, makeCtx, withTempDir } from '../helpers/fixtures'

const text = (t: string) => plainTextToRichDoc(t)
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('DocumentSession', () => {
  it('creates the file immediately and reopens it (requirements 4.1)', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'Идея.branchchat')
      const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
      expect((await readDocument(file)).contents.discussion.title).toBe('Идея')
      expect(s.view(anna.participantId).discussion.participants.map((p) => p.displayName)).toEqual([
        'Анна'
      ])
      expect((await DocumentSession.open(file, { ctx: makeCtx('o') })).documentId).toBe(
        s.documentId
      )
    })
  })

  it('shows a message immediately and saves it (FR-007)', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.branchchat')
      const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
      const threadId = mainThread(s.view(anna.participantId).discussion).threadId
      s.appendMessage(anna, threadId, text('Привет'))
      expect(mainThread(s.view(anna.participantId).discussion).messages).toHaveLength(1)
      expect(s.saving).toBe(true)
      await s.flush()
      expect(s.saving).toBe(false)
      expect(s.saveError).toBeNull()
      expect(mainThread((await readDocument(file)).contents.discussion).messages).toHaveLength(1)
    })
  })

  it('adds a new participant on their first message and marks earlier messages read (FR-112)', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.branchchat')
      const ctx = makeCtx()
      const s = await DocumentSession.create(file, { ctx }, { author: anna })
      const threadId = mainThread(s.view(anna.participantId).discussion).threadId
      s.appendMessage(anna, threadId, text('вопрос'))
      s.appendMessage(boris, threadId, text('ответ'))
      await s.flush()
      const saved = (await readDocument(file)).contents
      expect(saved.discussion.participants.map((p) => p.participantId)).toEqual([
        anna.participantId,
        boris.participantId
      ])
      expect(saved.readState[boris.participantId]).toEqual([
        mainThread(saved.discussion).messages[0]!.messageId
      ])
    })
  })

  it('coalesces quick changes into few writes and never writes concurrently', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'a.branchchat')
      let active = 0
      let maxActive = 0
      const gate = deferred()
      const writes: number[] = []
      const writer: DocumentWriter = async (p, c, o) => {
        active++
        maxActive = Math.max(maxActive, active)
        if (writes.length === 1) await gate.promise // hold the first non-create write
        writes.push(mainThread(c.discussion).messages.length)
        await writeDocument(p, c, o)
        active--
      }
      const s = await DocumentSession.create(file, { ctx: makeCtx(), writer }, { author: anna })
      const threadId = mainThread(s.view(anna.participantId).discussion).threadId
      for (let i = 0; i < 20; i++) s.appendMessage(anna, threadId, text(`m${i}`))
      gate.resolve()
      await s.flush()
      expect(maxActive).toBe(1)
      expect(writes.length).toBeLessThan(20) // creation + a few coalesced writes
      expect(writes.at(-1)).toBe(20) // the last write contains everything
      expect(mainThread((await readDocument(file)).contents.discussion).messages).toHaveLength(20)
    })
  })

  it('keeps changes in memory when saving fails, reports it, and recovers (FR-008)', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'sub', 'a.branchchat')
      await fs.mkdir(join(dir, 'sub'))
      const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
      const threadId = mainThread(s.view(anna.participantId).discussion).threadId
      await fs.rm(join(dir, 'sub'), { recursive: true })

      let changes = 0
      s.onChange = () => void changes++
      s.appendMessage(anna, threadId, text('не сохранится сразу'))
      await s.flush()
      expect(s.saveError).toMatch(/Не удалось записать файл|Нет доступа/)
      expect(s.view(anna.participantId).saveError).toBe(s.saveError)
      expect(mainThread(s.view(anna.participantId).discussion).messages).toHaveLength(1) // not lost
      expect(changes).toBeGreaterThanOrEqual(2) // change + save finished

      await fs.mkdir(join(dir, 'sub'))
      await s.retrySave()
      expect(s.saveError).toBeNull()
      expect(mainThread((await readDocument(file)).contents.discussion).messages).toHaveLength(1)
    })
  })

  it('surfaces domain errors without changing state', async () => {
    await withTempDir(async (dir) => {
      const s = await DocumentSession.create(
        join(dir, 'a.branchchat'),
        { ctx: makeCtx() },
        { author: anna }
      )
      const threadId = mainThread(s.view(anna.participantId).discussion).threadId
      expect(() => s.appendMessage(anna, threadId, text('   '))).toThrow(/empty/)
      expect(() => s.appendMessage(anna, 'no-such-thread', text('x'))).toThrow(/not found/)
      expect(s.saving).toBe(false)
    })
  })

  it('creation fails loudly when the file cannot be written', async () => {
    await withTempDir(async (dir) => {
      await expect(
        DocumentSession.create(
          join(dir, 'missing-dir', 'a.branchchat'),
          { ctx: makeCtx() },
          { author: anna }
        )
      ).rejects.toMatchObject({ code: expect.stringMatching(/WRITE_FAILED|ACCESS_DENIED/) })
    })
  })
})

describe('DocumentSession branches', () => {
  async function sessionWithMessage(dir: string) {
    const file = join(dir, 'a.branchchat')
    const s = await DocumentSession.create(file, { ctx: makeCtx() }, { author: anna })
    const threadId = mainThread(s.view(anna.participantId).discussion).threadId
    s.appendMessage(anna, threadId, text('Привет, это идея про ёлку.'))
    const messageId = mainThread(s.view(anna.participantId).discussion).messages[0]!.messageId
    return { file, s, threadId, messageId }
  }

  it('creates a branch with the quote taken from the stored message, marks the source read, and saves (FR-112)', async () => {
    await withTempDir(async (dir) => {
      const { file, s, messageId } = await sessionWithMessage(dir)
      const branchId = s.createBranch(boris, {
        sourceMessageId: messageId,
        selectionStart: 17,
        selectionEnd: 25
      })
      await s.flush()
      const saved = (await readDocument(file)).contents
      const branch = saved.discussion.threads.find((t) => t.threadId === branchId)!
      expect(branch).toMatchObject({
        sourceMessageId: messageId,
        quoteText: 'про ёлку',
        selectionStart: 17,
        selectionEnd: 25,
        status: 'open',
        createdBy: boris.participantId
      })
      expect(saved.readState[boris.participantId]).toEqual([messageId]) // replying marks the source message read
      expect(saved.discussion.participants.map((p) => p.participantId)).toContain(
        boris.participantId
      )
    })
  })

  it('refuses selections outside the message, empty selections and unknown messages', async () => {
    await withTempDir(async (dir) => {
      const { s, messageId } = await sessionWithMessage(dir)
      await s.flush() // the setup message has been saved; from here on nothing may be scheduled
      const base = { sourceMessageId: messageId }
      expect(() => s.createBranch(boris, { ...base, selectionStart: 5, selectionEnd: 5 })).toThrow()
      expect(() =>
        s.createBranch(boris, { ...base, selectionStart: 0, selectionEnd: 9999 })
      ).toThrow(/outside/)
      expect(() =>
        s.createBranch(boris, { sourceMessageId: 'ghost', selectionStart: 0, selectionEnd: 3 })
      ).toThrow(/not found/)
      expect(() => s.createBranch(boris, { ...base, selectionStart: 7, selectionEnd: 8 })).toThrow(
        /non-empty/
      ) // a space
      expect(s.saving).toBe(false) // nothing was changed or scheduled
    })
  })

  it('closing, reopening and titles are saved; a closed branch takes no messages', async () => {
    await withTempDir(async (dir) => {
      const { file, s, messageId } = await sessionWithMessage(dir)
      const branchId = s.createBranch(boris, {
        sourceMessageId: messageId,
        selectionStart: 0,
        selectionEnd: 6
      })
      s.setThreadTitle(branchId, '  Приветствие ')
      s.setThreadStatus(branchId, 'closed')
      await s.flush()
      const closed = (await readDocument(file)).contents.discussion.threads.find(
        (t) => t.threadId === branchId
      )!
      expect(closed).toMatchObject({ status: 'closed', title: 'Приветствие' })
      expect(() => s.appendMessage(boris, branchId, text('ещё'))).toThrow(/closed/)

      s.setThreadStatus(branchId, 'open')
      s.appendMessage(boris, branchId, text('ещё'))
      await s.flush()
      const reopened = (await readDocument(file)).contents.discussion.threads.find(
        (t) => t.threadId === branchId
      )!
      expect(reopened.status).toBe('open')
      expect(reopened.messages).toHaveLength(1)
      expect(() =>
        s.setThreadStatus(mainThread(s.view(anna.participantId).discussion).threadId, 'closed')
      ).toThrow(/main thread/)
    })
  })
})
