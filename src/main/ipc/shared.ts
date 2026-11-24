import { texts } from '@shared/i18n'
import { IPC, type RosterView } from '@shared/types/ipc'
import {
    decideKeysSchema,
    dropFilesForSchema,
    joinImportSchema,
    noPayloadSchema,
    sharedCreateSchema,
    sharedInviteSchema,
    sharedParseKeySchema,
    sharedReinviteSchema,
    sharedRootSchema
} from '@shared/validation'
import { AppError } from '../application/errors'
import { groupFingerprint } from '../crypto/identity'
import type { IpcContext } from './context'

/** Synchronized discussions: wizards, roster, key decisions (FR-158, FR-162, FR-176, FR-177). */
export function registerSharedHandlers(ctx: IpcContext): void {
    const { handle, controller, settings, sync, shared, onboarding, requireSession } = ctx
    handle(IPC.sharedPickFolder, noPayloadSchema, async (entry) => {
        const path = await shared?.ui.pickFolder(entry?.win)
        if (!path) return null
        return { path, test: await onboarding().testFolder(path) }
    })
    handle(IPC.sharedPublishKey, sharedRootSchema, async (_e, p) => {
        await onboarding().publishOwnKey(p.root)
        return null
    })
    handle(IPC.sharedCandidates, sharedRootSchema, (_e, p) => onboarding().candidates(p.root))
    handle(IPC.sharedParseKey, sharedParseKeySchema, (_e, p) => onboarding().parseKey(p.text))
    handle(IPC.sharedPickKeyFile, noPayloadSchema, async (entry) => {
        const path = await shared?.ui.pickKeyFile(entry?.win)
        return path ? onboarding().readKeyFile(path) : null
    })
    handle(IPC.sharedCreate, sharedCreateSchema, async (entry, p) => {
        if (p.mode === 'convert') {
            const session = requireSession(entry)
            if (session.current.sync) throw new AppError('FOLDER_IN_USE', 'already shared')
            await onboarding().create({ root: p.root, keys: p.keys, session })
            await shared?.background?.discussionAdded()
            session.onChange()
            return true
        }
        const id = await onboarding().create({
            root: p.root,
            title: p.title ?? texts().shared.defaultFileName,
            keys: p.keys
        })
        await shared?.background?.discussionAdded()
        await controller.openDiscussion(id, entry)
        return true
    })
    handle(IPC.sharedInvite, sharedInviteSchema, async (entry, p) => {
        const count = await onboarding().inviteMembers({
            session: requireSession(entry),
            keys: p.keys
        })
        entry?.session?.onChange()
        return count
    })
    handle(IPC.sharedReinvite, sharedReinviteSchema, async (entry, p) => {
        await onboarding().reinviteMember({
            session: requireSession(entry),
            participantId: p.participantId,
            key: p.key
        })
        entry?.session?.onChange()
        return null
    })
    handle(IPC.syncDropFilesFor, dropFilesForSchema, async (entry, p) => {
        const session = requireSession(entry)
        await sync?.dropFilesFor(session.documentId, p.participantId)
        return null
    })
    handle(IPC.syncDecideKeys, decideKeysSchema, async (entry, p) => {
        const session = requireSession(entry)
        await sync?.decideKeys(session.documentId, p.participantId, p.accept)
        return null
    })
    handle(IPC.sharedRoster, noPayloadSchema, (entry): RosterView | null => {
        const session = entry?.session
        const roster = session?.current.sync
        const running = session ? sync?.entryOf(session.documentId) : null
        if (!session || !roster || !session.synced || !running) return null
        const states = sync?.invitationStatus(session.documentId) ?? {}
        const me = settings.get().participantId
        const names = new Map(roster.members.map((m) => [m.participantId, m.displayName]))
        return {
            sharedRoot: running.sharedRoot,
            members: roster.members.map((m) => ({
                participantId: m.participantId,
                displayName: m.displayName,
                fingerprint: groupFingerprint(m.fingerprint),
                state: m.participantId === me ? 'self' : (states[m.participantId] ?? 'member'),
                addedByName:
                    m.addedBy === m.participantId ? null : (names.get(m.addedBy) ?? m.addedBy)
            }))
        }
    })
    handle(IPC.syncCheckNow, noPayloadSchema, async (entry) => {
        const session = requireSession(entry)
        await sync?.checkNow(session)
        return null
    })
    handle(IPC.joinFind, sharedRootSchema, (_e, p) => onboarding().findInvitation(p.root))
    handle(IPC.joinImport, joinImportSchema, async (entry, p) => {
        const found = await onboarding().findInvitation(p.root)
        if (found.state !== 'ready' || found.invitationId !== p.invitationId)
            throw new AppError('INVITATION_GONE', 'the invitation is not available')
        const id = await onboarding().importInvitation(p.root, p.invitationId)
        await shared?.background?.discussionAdded()
        await controller.openDiscussion(id, entry)
        return true
    })
}
