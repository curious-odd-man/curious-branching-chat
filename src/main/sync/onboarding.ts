import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { SYNC_PROTOCOL_VERSION, normalizeSynced, type KeyBundle } from '@shared/sync'
import type { DocumentContents, RosterMember } from '@shared/validation'
import type { DomainContext } from '@shared/domain'
import type { DocumentSession } from '../application/documentSession'
import { AppError } from '../application/errors'
import { sha256Hex, openUnverified, verifyFrame, type UnverifiedFrame } from '../crypto/envelope'
import {
    b64,
    fingerprintOf,
    fromB64,
    groupFingerprint,
    keyBundleToFile,
    keyBundleToText,
    keyFileName,
    makeKeyBundle,
    parseKeyBundle,
    verifyKeyBundle
} from '../crypto/identity'
import type { KeyStore } from '../crypto/keyStore'
import { newDocumentContents, readDocument, writeDocument } from '../document'
import type { SettingsStore } from '../local-state/settings'
import { FolderTransport, isInside, type FolderTestResult } from '../transport/folderTransport'
import type { SyncRegistry } from './registry'
import type { SyncService } from './syncService'

/** A public key that could become a member (design 12.3, step 7). */
export interface CandidateView {
    participantId: string
    displayName: string
    /** 8 groups of 4 characters */
    fingerprint: string
    /** The bundle in its text form; the wizard sends it back when the person accepts the candidate. */
    text: string
}

export type InvitationView =
    | { state: 'waiting' }
    | { state: 'incomplete'; received: number; total: number }
    | {
          state: 'ready'
          invitationId: string
          conversationId: string
          title: string
          inviterName: string
          /** 8 groups of 4: the person compares it with what the inviter tells them (FR-162). */
          inviterFingerprint: string
          /** D-15: a re-invitation after key loss; this person gets the old participant ID back. */
          rejoin: boolean
      }
    /** This computer already has this discussion. */
    | { state: 'already'; conversationId: string }

export interface OnboardingDeps {
    userData: string
    keys: KeyStore
    settings: SettingsStore
    registry: SyncRegistry
    sync: SyncService
    ctx: DomainContext
    appVersion: string
}

/** Wizards of design sections 12.3 to 12.5 (FR-158, FR-162). */
export class Onboarding {
    constructor(private readonly deps: OnboardingDeps) {}

    private transport(root: string): FolderTransport {
        return new FolderTransport(root, join(this.deps.userData, 'sync', '_onboarding', 'staging'))
    }

    private me(): { participantId: string; displayName: string } {
        const { participantId, displayName } = this.deps.settings.get()
        if (!displayName) throw new AppError('NAME_REQUIRED', 'A participant name is required')
        return { participantId, displayName }
    }

    private async identity() {
        const { identity } = await this.deps.keys.ensure(this.deps.settings.get().participantId)
        if (identity.state !== 'ready')
            throw new AppError('KEYS_UNAVAILABLE', 'keys are not available')
        return identity
    }

    async ownBundle(): Promise<KeyBundle> {
        const me = this.me()
        const identity = await this.identity()
        return makeKeyBundle(identity.identity, me.displayName, new Date().toISOString(), (d) =>
            this.deps.keys.sign(me.participantId, d)
        )
    }

    /** Write, read, and delete a test file (design 12.3, step 5). */
    testFolder(root: string): Promise<FolderTestResult> {
        return this.transport(root).folderTest()
    }

    /** The own public key goes to `keys/` in the shared folder (D-21). */
    async publishOwnKey(root: string): Promise<void> {
        const bundle = await this.ownBundle()
        await this.transport(root).publish(
            { kind: 'keys' },
            keyFileName(bundle.participantId),
            new TextEncoder().encode(keyBundleToFile(bundle))
        )
    }

    private async view(bundle: KeyBundle): Promise<CandidateView> {
        return {
            participantId: bundle.participantId,
            displayName: bundle.displayName,
            fingerprint: groupFingerprint(bundle.fingerprint),
            text: keyBundleToText(bundle)
        }
    }

    /** Valid keys in `keys/`, except the own one. Damaged or foreign files are left out. */
    async candidates(root: string): Promise<CandidateView[]> {
        const t = this.transport(root)
        const own = this.deps.settings.get().participantId
        const out: CandidateView[] = []
        for (const entry of await t.list({ kind: 'keys' })) {
            try {
                const bytes = await t.read({ kind: 'keys' }, entry.name, 64 * 1024)
                const bundle = await parseKeyBundle(new TextDecoder().decode(bytes))
                if (bundle.participantId === own) continue
                if (out.some((c) => c.participantId === bundle.participantId)) continue
                out.push(await this.view(bundle))
            } catch {
                // not a valid key: ignored
            }
        }
        return out.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
    }

    /** A key pasted as text (D-21). */
    async parseKey(text: string): Promise<CandidateView> {
        try {
            const bundle = await parseKeyBundle(text)
            if (bundle.participantId === this.deps.settings.get().participantId)
                throw new AppError('OWN_KEY', 'this is the own key')
            return await this.view(bundle)
        } catch (err) {
            if (err instanceof AppError) throw err
            throw new AppError('INVALID_KEY', 'not a valid key')
        }
    }

    /** A `.bckey` file the person chose (D-21). */
    async readKeyFile(path: string): Promise<CandidateView> {
        let text: string
        try {
            const st = await fs.stat(path)
            if (st.size > 64 * 1024) throw new Error('too large')
            text = await fs.readFile(path, 'utf8')
        } catch {
            throw new AppError('INVALID_KEY', 'cannot read the key file')
        }
        return this.parseKey(text)
    }

    private async member(
        bundle: KeyBundle,
        addedBy: string,
        addedAt: string
    ): Promise<RosterMember> {
        const verified = await verifyKeyBundle(bundle)
        return {
            participantId: verified.participantId,
            displayName: verified.displayName,
            signingPublicKey: verified.signingPublicKey,
            encryptionPublicKey: verified.encryptionPublicKey,
            fingerprint: verified.fingerprint,
            addedBy,
            addedAt
        }
    }

    /**
     * FR-176, D-13: any member invites new people into the open, active discussion. The roster gets them (with
     * `addedBy` = this member), every earlier member gets `member.added`, and each new member gets an invitation with
     * the current discussion. Returns the number of new members.
     */
    async inviteMembers(input: {
        session: DocumentSession
        keys: readonly string[]
    }): Promise<number> {
        const me = this.me()
        await this.identity()
        const session = input.session
        const roster = session.current.sync
        const entry = roster ? this.deps.sync.entryOf(session.documentId) : null
        if (!roster || !session.synced || !entry)
            throw new AppError('NOT_SHARED', 'not an active synchronized discussion')
        const now = this.deps.ctx.now()
        const known = new Set(roster.members.map((m) => m.participantId))
        const fresh: RosterMember[] = []
        for (const text of input.keys) {
            const bundle = await parseKeyBundle(text).catch(() => {
                throw new AppError('INVALID_KEY', 'not a valid key')
            })
            if (known.has(bundle.participantId))
                throw new AppError('ALREADY_MEMBER', 'this person is already a member')
            if (fresh.some((m) => m.participantId === bundle.participantId)) continue
            fresh.push(await this.member(bundle, me.participantId, now))
        }
        if (fresh.length === 0) throw new AppError('NO_MEMBERS', 'no new member')
        const after = await this.deps.sync.addMembers(entry.conversationId, fresh)
        if (session.saveError) throw new AppError('WRITE_FAILED', 'cannot write the file')
        await this.publishOwnKey(entry.sharedRoot)
        // the snapshot is the file itself, with the new roster and all images (sync-protocol.md 7.10)
        const snapshot = new Uint8Array(await fs.readFile(entry.filePath))
        for (const m of fresh)
            await this.deps.sync.invite(entry.conversationId, m.participantId, snapshot, after)
        return fresh.length
    }

    /**
     * FR-177, D-15: re-invites a member who lost the keys. `key` is the person's new public key (its participant ID
     * can be new); the member keeps the old ID. The other members must accept the new keys.
     */
    async reinviteMember(input: {
        session: DocumentSession
        participantId: string
        key: string
    }): Promise<void> {
        const me = this.me()
        await this.identity()
        const session = input.session
        const roster = session.current.sync
        const entry = roster ? this.deps.sync.entryOf(session.documentId) : null
        if (!roster || !session.synced || !entry)
            throw new AppError('NOT_SHARED', 'not an active synchronized discussion')
        const member = roster.members.find((m) => m.participantId === input.participantId)
        if (!member || member.participantId === me.participantId)
            throw new AppError('NOT_MEMBER', 'not another member')
        const bundle = await parseKeyBundle(input.key).catch(() => {
            throw new AppError('INVALID_KEY', 'not a valid key')
        })
        const verified = await verifyKeyBundle(bundle)
        // the new key belongs to this person: either the same ID, or an ID that is no member
        if (
            verified.participantId !== member.participantId &&
            roster.members.some((m) => m.participantId === verified.participantId)
        )
            throw new AppError('ALREADY_MEMBER', 'this key belongs to another member')
        if (verified.fingerprint === member.fingerprint)
            throw new AppError('SAME_KEY', 'the member already has this key')
        const after = await this.deps.sync.replaceKeys(entry.conversationId, member.participantId, {
            signingPublicKey: verified.signingPublicKey,
            encryptionPublicKey: verified.encryptionPublicKey,
            fingerprint: verified.fingerprint
        })
        if (session.saveError) throw new AppError('WRITE_FAILED', 'cannot write the file')
        await this.publishOwnKey(entry.sharedRoot)
        const snapshot = new Uint8Array(await fs.readFile(entry.filePath))
        await this.deps.sync.invite(entry.conversationId, member.participantId, snapshot, after, {
            inboxId: verified.participantId
        })
    }

    /**
     * Makes a synchronized discussion (design 12.3 and 12.4): the roster has this member and the accepted candidates.
     * With `session`, the open discussion is converted (D-02); otherwise a new file is created at `filePath`.
     * Returns the local file path.
     */
    async create(input: {
        root: string
        filePath: string
        keys: readonly string[]
        session?: DocumentSession
    }): Promise<string> {
        const me = this.me()
        const identity = await this.identity()
        if (isInside(input.root, input.filePath))
            throw new AppError(
                'FILE_IN_SHARED_FOLDER',
                'the file must be outside the shared folder'
            )
        const test = await this.testFolder(input.root)
        if (!test.ok) throw new AppError('FOLDER_TEST_FAILED', `folder test failed at ${test.step}`)
        const marker = await this.transport(input.root).readMarker()
        if (marker)
            throw new AppError('FOLDER_IN_USE', 'the shared folder already has a discussion')

        const now = this.deps.ctx.now()
        const own: RosterMember = {
            participantId: me.participantId,
            displayName: me.displayName,
            signingPublicKey: b64(identity.identity.signingPublicKey),
            encryptionPublicKey: b64(identity.identity.encryptionPublicKey),
            fingerprint: fingerprintOf(
                identity.identity.signingPublicKey,
                identity.identity.encryptionPublicKey
            ),
            addedBy: me.participantId,
            addedAt: now
        }
        const others: RosterMember[] = []
        for (const text of input.keys) {
            const bundle = await parseKeyBundle(text).catch(() => {
                throw new AppError('INVALID_KEY', 'not a valid key')
            })
            if (
                bundle.participantId === me.participantId ||
                others.some((o) => o.participantId === bundle.participantId)
            )
                continue
            others.push(await this.member(bundle, me.participantId, now))
        }
        if (others.length === 0)
            throw new AppError('NO_MEMBERS', 'at least one other member is needed')
        const sync = { protocolVersion: SYNC_PROTOCOL_VERSION, members: [own, ...others] }

        let contents: DocumentContents
        if (input.session) {
            await input.session.flush()
            contents = input.session.adoptSync(sync)
            await input.session.flush()
            if (input.session.saveError) throw new AppError('WRITE_FAILED', 'cannot write the file')
        } else {
            const base = newDocumentContents(this.deps.ctx, {
                title: basename(input.filePath).replace(/\.branchchat$/i, ''),
                author: me,
                generator: { name: 'BranchChat', version: this.deps.appVersion }
            })
            contents = normalizeSynced({ ...base, sync })
            await writeDocument(input.filePath, contents, { discardExisting: true })
        }

        const entry = {
            conversationId: contents.manifest.documentId,
            filePath: input.filePath,
            sharedRoot: input.root,
            ownId: me.participantId
        }
        await this.deps.registry.put(entry)
        await this.deps.sync.open(entry)
        if (input.session) await this.deps.sync.attach(input.session)
        await this.publishOwnKey(input.root)
        // the snapshot is the file itself, with the roster and all images (sync-protocol.md 7.10)
        const snapshot = new Uint8Array(await fs.readFile(input.filePath))
        for (const m of others)
            await this.deps.sync.invite(entry.conversationId, m.participantId, snapshot, contents)
        return input.filePath
    }

    /** Looks for an invitation in the own inbox (design 12.5, step 3). */
    async findInvitation(root: string): Promise<InvitationView> {
        const found = await this.readInvitation(root)
        if (found.state !== 'ready') return found
        const { inviter, invitation, contents, replacesKeysOf } = found
        if (!replacesKeysOf && this.deps.registry.get(contents.manifest.documentId))
            return { state: 'already', conversationId: contents.manifest.documentId }
        return {
            state: 'ready',
            invitationId: invitation.payload.invitationId,
            conversationId: contents.manifest.documentId,
            title: contents.discussion.title,
            inviterName: inviter.displayName,
            inviterFingerprint: groupFingerprint(inviter.fingerprint),
            rejoin: replacesKeysOf !== null
        }
    }

    private tempSnapshot(invitationId: string): string {
        return join(this.deps.userData, 'sync', '_join', `${invitationId}.branchchat`)
    }

    private async readInvitation(root: string): Promise<
        | Exclude<InvitationView, { state: 'ready' }>
        | {
              state: 'ready'
              invitation: UnverifiedFrame['envelope'] & {
                  payload: { invitationId: string; parts: Array<{ partId: string }> }
              }
              inviter: RosterMember
              contents: DocumentContents
              fileNames: string[]
              ids: string[]
              /** D-15: the old participant ID of this person, for a re-invitation. */
              replacesKeysOf: string | null
          }
    > {
        const t = this.transport(root)
        const ownId = this.deps.settings.get().participantId
        const folder = { kind: 'inbox' as const, participantId: ownId }
        const entries = await t.list(folder)
        const limit = this.deps.settings.get().fileSizeLimitMb * 1024 * 1024
        const open = (s: Uint8Array) => this.deps.keys.openSealed(ownId, s)
        let best: { state: 'incomplete'; received: number; total: number } | null = null

        for (const header of entries.filter((e) => e.extension === 'bcinv')) {
            let frame: UnverifiedFrame | null
            try {
                frame = await openUnverified(await t.read(folder, header.name, limit), open)
            } catch {
                continue
            }
            if (
                !frame ||
                frame.envelope.type !== 'invitation' ||
                frame.envelope.recipientId !== ownId
            )
                continue
            const payload = frame.envelope.payload as {
                invitationId: string
                minProtocolVersion: number
                replacesKeysOf?: string
                snapshotSize: number
                snapshotSha256: string
                parts: Array<{ partId: string; index: number; size: number; sha256: string }>
            }
            if (payload.minProtocolVersion > SYNC_PROTOCOL_VERSION) continue
            const frames: UnverifiedFrame[] = [frame]
            const fileNames = [header.name]
            const chunks = new Map<string, Uint8Array>()
            for (const p of payload.parts) {
                const file = entries.find((e) => e.extension === 'bcpart' && e.id === p.partId)
                if (!file) continue
                try {
                    const pf = await openUnverified(await t.read(folder, file.name, limit), open)
                    const pp = pf?.envelope.payload as
                        { invitationId?: string; partId?: string } | undefined
                    if (
                        !pf ||
                        pf.envelope.type !== 'invitation.part' ||
                        pp?.invitationId !== payload.invitationId
                    )
                        continue
                    if (pf.payload.length !== p.size || sha256Hex(pf.payload) !== p.sha256) continue
                    chunks.set(p.partId, pf.payload)
                    frames.push(pf)
                    fileNames.push(file.name)
                } catch {
                    // still being copied: next time
                }
            }
            if (chunks.size < payload.parts.length) {
                const view = {
                    state: 'incomplete' as const,
                    received: chunks.size,
                    total: payload.parts.length
                }
                if (!best || view.received > best.received) best = view
                continue
            }
            const snapshot = Buffer.concat(
                [...payload.parts]
                    .sort((a, b) => a.index - b.index)
                    .map((p) => chunks.get(p.partId)!)
            )
            if (
                snapshot.length !== payload.snapshotSize ||
                sha256Hex(snapshot) !== payload.snapshotSha256
            )
                continue

            // the snapshot is read like any file: full validation (NFR-014)
            const temp = this.tempSnapshot(payload.invitationId)
            await fs.mkdir(join(temp, '..'), { recursive: true })
            await fs.writeFile(temp, snapshot)
            let contents: DocumentContents
            try {
                contents = (await readDocument(temp)).contents
            } catch {
                continue
            }
            if (contents.manifest.documentId !== frame.envelope.conversationId || !contents.sync)
                continue
            const inviter = contents.sync.members.find(
                (m) => m.participantId === frame.envelope.senderId
            )
            // a re-invitation (D-15) names the old ID; the roster has this person there, with the new keys
            const selfId = payload.replacesKeysOf ?? ownId
            const self = contents.sync.members.find((m) => m.participantId === selfId)
            const identity = await this.identity()
            const ownFingerprint = fingerprintOf(
                identity.identity.signingPublicKey,
                identity.identity.encryptionPublicKey
            )
            if (!inviter || !self || self.fingerprint !== ownFingerprint) continue
            const key = fromB64(inviter.signingPublicKey)
            let valid = true
            for (const f of frames) if (!(await verifyFrame(f, key))) valid = false
            if (!valid) continue
            return {
                state: 'ready',
                invitation: frame.envelope as never,
                inviter,
                contents,
                fileNames,
                ids: [payload.invitationId, ...payload.parts.map((p) => p.partId)],
                replacesKeysOf: payload.replacesKeysOf ?? null
            }
        }
        return best ?? { state: 'waiting' }
    }

    /** Saves the invited discussion and starts its sync (design 12.5, steps 4 and 5). */
    async importInvitation(
        root: string,
        invitationId: string,
        targetPath: string
    ): Promise<string> {
        if (isInside(root, targetPath))
            throw new AppError(
                'FILE_IN_SHARED_FOLDER',
                'the file must be outside the shared folder'
            )
        const found = await this.readInvitation(root)
        if (found.state !== 'ready' || found.invitation.payload.invitationId !== invitationId)
            throw new AppError('INVITATION_GONE', 'the invitation is not available')
        const conversationId = found.contents.manifest.documentId
        await fs.copyFile(this.tempSnapshot(invitationId), targetPath)
        await fs.rm(this.tempSnapshot(invitationId), { force: true })
        // D-32: a re-invitation gives the old participant ID back; the new keys are bound to it
        const inboxId = this.deps.settings.get().participantId
        const oldId = found.replacesKeysOf
        if (oldId && oldId !== inboxId) {
            await this.deps.keys.rebind(inboxId, oldId)
            await this.deps.settings.setParticipantId(oldId)
            await this.transport(root)
                .delete({ kind: 'keys' }, keyFileName(inboxId))
                .catch(() => undefined)
        }
        const entry = {
            conversationId,
            filePath: targetPath,
            sharedRoot: root,
            ownId: this.deps.settings.get().participantId
        }
        await this.deps.registry.put(entry)
        if (oldId) await this.deps.sync.restart(entry)
        else await this.deps.sync.open(entry)
        await this.publishOwnKey(root)
        // before the first scan: files for the old key are set aside, not quarantined
        if (oldId) await this.deps.sync.startRejoin(conversationId, found.inviter.participantId)
        await this.deps.sync.confirmInvitation(
            conversationId,
            found.inviter.participantId,
            found.ids,
            found.fileNames,
            inboxId
        )
        return targetPath
    }
}
