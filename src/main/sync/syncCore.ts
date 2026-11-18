import type { SharedFolder } from '../transport/folderTransport'
import { AttachmentLoader } from './attachmentLoader'
import { EventProcessor } from './eventProcessor'
import { InboxReader } from './inboxReader'
import { SyncSender } from './syncSender'
import type { SyncState } from './syncState'
import type { ConversationSyncDeps, FolderHealth } from './syncTypes'

/**
 * What the units of the sync engine share (code review 4.1): the dependencies, the state, the folder health, and
 * each other. The units are not used outside `ConversationSync`, which runs one operation at a time.
 */
export class SyncCore {
    /** The health of the shared folder, as the last write or scan found it. */
    folder: FolderHealth = 'ok'
    readonly sender: SyncSender
    readonly reader: InboxReader
    readonly events: EventProcessor
    readonly loader: AttachmentLoader

    constructor(readonly deps: ConversationSyncDeps) {
        this.sender = new SyncSender(this)
        this.reader = new InboxReader(this)
        this.events = new EventProcessor(this)
        this.loader = new AttachmentLoader(this)
    }

    get state(): SyncState {
        return this.deps.state
    }

    inbox(participantId: string): SharedFolder {
        return { kind: 'inbox', participantId }
    }
}
