# Design: Private Group Chat with Replicated Conversation State

**Status:** Proposed  
**Platform:** Windows desktop  
**Transport model:** Provider-independent file transport; Google Drive for Desktop is optional  
**Backend:** None  
**Google integration:** No Drive API, OAuth flow, or app-managed Google credentials

## 1. Overview

This document describes a Windows desktop chat application that exchanges messages through a provider-independent file
transport. Google Drive for Desktop is an optional transport adapter, not a requirement. Other adapters may use another
synchronization product, a user-selected shared folder, or a manually moved folder/package. The application must also be
able to run without Google Drive installed.

For a synchronized conversation, participants exchange immutable encrypted message files and a canonical
conversation-state file called the **BranchChat file**. Each participant maintains a local copy of the BranchChat file.
The BranchChat file retains the application's existing shared conversation structure. Do not impose byte-for-byte
convergence as a new protocol requirement without first inspecting how the existing application updates and shares this
file. It must never contain private keys.

The application treats any synchronized file transport as **untrusted and eventually consistent**. It discovers incoming
files using
filesystem notifications plus periodic scans where available. It must not depend on a Google API, OAuth flow,
app-managed Google credentials, or an application-operated backend.

The design must support:

- One-to-one conversations and group conversations.
- A shared BranchChat file that preserves the existing application's format and can be exchanged between participants.
- New participants joining by receiving the BranchChat file, completing key exchange, and obtaining access to the
  selected transport location.
- Rejoining with a newly generated identity after loss of private keys, subject to the history limitation described
  below.
- Operation without Google Drive, through another transport adapter or in local-only mode.

A message can be delivered while its recipient is offline only if the chosen transport retains the encrypted file until
the recipient reconnects. This behavior depends on the selected provider; local-only mode cannot deliver to another
device. There is no guarantee of immediate delivery or a reliable way for a folder-based adapter to know that a locally
written file has reached a remote provider.

## 2. Goals and non-goals

### Goals

- Windows desktop application built with Electron, Node.js, and React.
- One-to-one and multi-participant conversations.
- No application-operated server or hosting cost.
- No Google Drive API or OAuth integration.
- Participants may manually create/share a root folder and configure its local path when using a folder-sync provider.
- End-to-end encryption and sender authentication.
- Offline recipient delivery after a message has synchronized to the provider.
- At-least-once transport with idempotent processing and recovery from missed events, duplicates, and sync delays.
- A transport abstraction that allows other file-synchronization implementations to be added later.
- Preserve existing local conversation storage and image handling where practical.
- Provide a first-run/create-chat wizard, invokable from the application's main menu, for one-to-one and group chat
  setup, key generation, public-key exchange, and transport setup.
- Do not support user message edits or deletions in v1.
- Do not support leaving a conversation in v1.

### Non-goals and limitations

- No anonymity from Google or another synchronization provider. Providers can observe account relationships, folder
  membership, file metadata, sizes, timestamps, access patterns, and approximate traffic volume.
- No guarantee of immediate delivery.
- No requirement to use Google Drive; remote exchange still requires some mutually accessible transport.
- No reliable indication that a locally written file has reached the cloud.
- No protection against a participant copying, exporting, photographing, or otherwise sharing plaintext.
- No multi-device identity support in the initial implementation.
- No user-initiated message edits/deletions or leave-chat operation in v1.
- No forward secrecy in the initial cryptographic proposal.
- No new generic attachment subsystem. Existing image handling is to remain unchanged; inspect the current application
  code before changing it.

## 3. Architecture

Separate the application into domain logic and transport implementations.

### 3.1 Application components

1. **React renderer:** conversation UI only.
2. **Electron main process:** application lifecycle, filesystem access through the transport adapter, IPC validation,
   and coordination.
3. **Conversation/domain layer:** participants, conversations, message events, ordering, delivery/read state, and local
   persistence.
4. **Cryptography module:** identity keys, signing, encryption, decryption, and verification. Run in the main process or
   a dedicated utility process, not in the renderer.
5. **Existing conversation storage:** continue using the current application's local storage model where possible.
   Inspect the repository before deciding whether and how to migrate it.
6. **Local transport-state database:** SQLite is a proposed option for outbox state, processed event IDs, receipts, and
   retry state. This database is local and must never be placed in the shared folder.
7. **BranchChat state manager:** validates, reads, writes, and reconciles the canonical shared BranchChat file. It
   separates shared conversation state from machine-local state.
8. **Transport abstraction:** a provider-independent interface for writing, reading, listing, watching, and deleting
   transport files.
9. **Optional transport adapters:** Google Drive for Desktop is one adapter; other adapters and local-only mode must not
   require Google components.

### 3.2 Data flow

```text
Chat UI
  |
  v
Conversation/domain layer
  |  create event, determine recipients
  v
Cryptography layer
  |  sign event; encrypt separately for each recipient
  v
Transport abstraction
  |
  +--> Generic local-folder adapter
  +--> Optional Google Drive for Desktop adapter
  +--> Future transport adapter(s)
  +--> Local-only mode (no remote exchange)
```

For each recipient, the transport adapter writes an independently encrypted copy to that recipient's inbox. The
recipient processes and deletes only its own inbox copy. This avoids one group participant deleting a shared message
file before the other participants have received it.

## 3.3 BranchChat file and shared state

BranchChat is the existing conversation file/document and should remain as close as practical to the application's
current format. Do not replace it with a newly invented manifest or redesign its schema before inspecting the existing
application code.

The current format information supplied for this design includes:

- A read-state object keyed by message/thread identifiers, with participant identifiers as values.
- A manifest with `format`, `schemaVersion`, `documentId`, `createdAt`, and `generator` fields.
- A discussion containing `title`, `participants`, `threads`, and `messages`.

The examples and field names above are illustrative of the current format supplied for this design; inspect the code
before treating them as a complete schema or changing serialization.

Requirements:

- Preserve existing fields, semantics, and compatibility wherever practical.
- Keep private keys and other secrets out of the BranchChat file.
- Do not add machine-specific local paths or local UI preferences unless the existing format already requires them.
- Do not assume that BranchChat is an administrator-signed, single-writer manifest.
- Participants are equal after the chat is initiated. Any participant may share their local BranchChat file with the
  other participants.
- The file may be updated through the existing application's normal behavior or manually shared between users.
- The application must tolerate receiving an updated file and must not silently destroy local data when replacing or
  importing it.

The exact update, conflict, and stale-copy behavior must follow the existing application's behavior where possible.
Remaining decisions are listed in Section 22.

## 4. Participants, conversations, and membership

### 4.1 Shared root

Each synchronized conversation has one transport root/location. All participants must have sufficient permissions to
create and delete their own transport files and the protocol files assigned to them. The application creates a
participant-specific directory for each member.

The root folder is a transport location, not an authority for identity. A person gaining access to the folder must not
automatically be trusted as a valid participant. Google Drive is optional; the same logical layout and transport
contract must be usable with another provider.

### 4.2 Participant identity

Each participant has:

- A stable application-level participant ID.
- An Ed25519 signing public/private key pair.
- A Curve25519 encryption public/private key pair.
- A key fingerprint for display/identification during bootstrap.

For the initial version, use one identity and one device per participant. Device linking and multi-device identity are
outside the initial scope.

### 4.3 Membership and invitations

For v1, access to the shared folder is sufficient to make a discovered public-key bundle eligible for consideration
during bootstrap. Folder access is not a cryptographic proof of a person's identity. The initiator must be able to
discard/reject a discovered participant public key during bootstrap.

Invitations are encrypted to the invitee's public encryption key. The design does not require an additional independent
delivery channel or additional invitation confidentiality layer.

The BranchChat file remains the existing conversation file. Its current format includes a manifest, read state, and
discussion data; see Section 3.3. Preserve the current format as closely as possible and inspect the implementation
before
changing it.

The initiator starts the conversation and performs the initial setup. After initiation, participants are equal: there is
no administrator role or permanent single-writer authority. Any participant may share an updated local BranchChat file.
Participants cannot remove other participants in v1, and participants cannot leave a conversation in v1.

A participant may be added after the conversation is active. The exact mechanics for authorizing, publishing, and
adopting a membership update are listed as open questions in Section 22.

## 4.4 Create-chat and onboarding wizard

The application must provide a guided wizard, accessible from the main menu (for example, **Chat → New chat / Set up
chat**). It must support both one-to-one and group conversations.

The wizard should guide the initiator through:

1. Choosing one-to-one or group chat.
2. Creating or selecting the conversation identity and generating signing/encryption key pairs when needed.
3. Showing the public keys and a copyable key bundle for the manual bootstrap process.
4. Explaining that private keys remain on the user's device and must never be uploaded or sent to other participants.
5. Selecting a transport: Google Drive for Desktop (optional), another configured transport adapter, or local-only mode.
6. If using a shared folder, explaining how to create/share the folder in the provider's own UI, grant appropriate
   permissions, and select the synchronized local folder.
7. Displaying the participant onboarding steps and waiting for the required public keys/invitations.
8. Reviewing the candidate public keys (with an option to discard a candidate) and showing the roster before the chat
   becomes active.

A participant joining an existing chat should have a corresponding **Join chat from invitation** flow. It should
validate the invitation and BranchChat file, configure/access the selected
transport, and then import the conversation metadata. The wizard must not claim that Google Drive is required.

The wizard should explain key backup/loss consequences in plain language. It should not upload private keys or make
cryptographic choices invisible to the user.

## 4.5 V1 membership constraints

- The initiator performs initial chat creation and onboarding; after that, all participants are equal.
- There is no administrator role and no permanent single-writer authority for BranchChat updates.
- Any participant may share their local BranchChat file with the other participants.
- Participants cannot leave a conversation in v1.
- Participants cannot remove other participants in v1.
- New participants may be added after the chat is active.
- A participant who loses private keys may generate a new identity and receive a new invitation containing the current
  chat state. A returning participant retains their existing participant ID; a genuinely new participant receives a new
  participant ID. The key-replacement and historical-message implications still need to be specified; see Section 22.

## 5. Shared-folder layout

Use participant-specific inboxes and receipt directories. Each sender writes a separate encrypted event copy into each
intended recipient's inbox.

The sender writes message files to the inbox of each other participant in the current BranchChat roster. A participant
writes its own receipt files in the inbox directory of a sender. A recipient deletes a message file from its own inbox
after it has successfully processed and persisted that event locally and has written the corresponding delivery receipt.

The sender processes receipt files and deletes each receipt file after it has been safely recorded locally. This
transport cleanup does not delete the message from any participant's local chat history. The sender retains its local
outbox copy according to local storage policy.

Use opaque IDs and generic filenames. Do not put message text, contact names, private keys, plaintext, local databases,
logs, or decrypted image data in the shared folder.

**Permissions requirement:** the folder-sharing configuration must allow each participant to create and delete files in
the shared root. Verify this with the actual Google Drive sharing configuration used by the application. If participants
cannot write to each other's inbox paths, this layout will not work without changing the folder structure or
permissions.

## 6. Event model and serialization

Treat message events as append-only and immutable. V1 does not support editing or deleting a sent message. Transport
housekeeping may still delete already-processed inbox and receipt files; this is protocol cleanup, not a user-visible
message deletion.

For a group message, the logical event has one event ID and one recipient-specific encrypted transport envelope per
recipient. The plaintext event can be the same for all recipients; the encrypted envelope is generated separately for
each recipient and includes that recipient's ID.

Initial event types:

- `message.sent`
- `receipt.delivered`
- `receipt.read`
- `branchchat.state.updated` (or a separately defined signed BranchChat update record)

There are no `message.edited` or `message.deleted` events in v1.

Use random unique event IDs and per-sender logical sequence numbers. Do not rely on filesystem timestamps, provider
timestamps, or file arrival order to establish message order. Ordering within a conversation should be based on
persisted event metadata and a defined tie-breaking rule for concurrent senders.

## 7. Cryptography

### 7.1 Recommended initial construction

For the initial implementation, use **libsodium sealed boxes for recipient-specific encryption, plus Ed25519 signatures
for sender authentication**.

Candidate dependency:

```bash
npm install chokidar libsodium-wrappers-sumo
```

Use separate key pairs for signing and encryption:

- Ed25519 key pair for signing.
- Curve25519 key pair for sealed-box encryption.

For each recipient:

1. Serialize the logical event using the canonical format.
2. Sign the serialized event with the sender's Ed25519 private key.
3. Include the signature and signed event in the plaintext envelope.
4. Encrypt that envelope to the recipient's Curve25519 public key using libsodium's sealed-box construction.
5. Write the resulting recipient-specific ciphertext to that recipient's inbox.

The recipient decrypts with its Curve25519 private key, then verifies the sender's Ed25519 signature using the
sender public key accepted during bootstrap. The signature must cover all security-relevant event fields, including
protocol version,
event ID, conversation ID, membership version, sender ID, recipient ID, sequence number, event type, and payload.

This approach is straightforward for small groups because the sender creates one encrypted copy per recipient. Its cost
grows linearly with the number of recipients and message size. It avoids inventing a custom group-key protocol.

Use the exact libsodium API and key formats documented by the library. Add protocol test vectors and negative tests. Do
not treat successful decryption as proof of sender identity; verify the signature separately.

### 7.2 Limitations

Sealed boxes do not provide forward secrecy against later compromise of a recipient's long-term private encryption key.
Forward secrecy is explicitly **not required for v1**. Document this limitation rather than introducing a custom
ratchet.

Participant removal is not supported in v1.

### 7.3 Key storage and lifecycle

- Keep private keys out of the renderer.
- Protect local private keys using Windows DPAPI or an appropriate Windows secure key-storage mechanism.
- Restrict access to key material and application data.
- Never log keys, plaintext, or decrypted payloads.
- No key backup/recovery workflow is required for the initial version. If private keys are lost, the participant must
  generate a new identity and be onboarded again. This permits rejoining and receiving future messages after the
  BranchChat state and membership are updated, but the new identity cannot decrypt old messages encrypted to the lost
  public key. Previously stored local history may remain readable only if the old local data/key material still exists.
- Device-loss revocation/replacement is not in the initial scope. Membership changes can exclude the old identity from
  future messages, but cannot invalidate old content or keys already copied.

Signatures and encryption do not by themselves prevent replay. Track processed event IDs, sender sequence state,
conversation ID, and membership version locally.

## 8. Outgoing message flow

1. User creates a message.
2. Conversation layer determines the current recipient set from the verified BranchChat file.
3. Main process validates the request and creates a unique event ID and sender sequence number.
4. Serialize the logical event canonically.
5. Sign the event with the sender's signing key.
6. For each recipient, create a sealed-box encrypted envelope using that recipient's public encryption key.
7. Save the logical event and recipient-specific outgoing envelopes in the local outbox/state database.
8. Write each envelope to a temporary file in local tmp directory.
9. Flush and close each file, then rename/move it to its final `.bcmsg` filename at the recepient inbox location.
10. Mark the local transport write as complete for that recipient.
11. Wait for signed delivery/read receipts from recipients.

Atomic local rename/move reduces the chance of observing a partial local write. It does not guarantee atomic publication
by
the synchronization provider or immediate availability to recipients.

If writing to some recipient inboxes succeeds and others fail, retain per-recipient state and retry only the missing
writes. Do not generate a new logical event ID for a retry.

## 9. Incoming message flow and recipient cleanup

For each incoming `.bcmsg` file:

1. Transport adapter reports a possible filesystem change or a full scan discovers the file.
2. Wait briefly for the file to become stable.
3. Validate envelope structure and size limits.
4. If incomplete or temporarily unavailable, defer and retry.
5. Decrypt using the local recipient encryption private key.
6. Verify the sender signature using the verified sender public key.
7. Verify conversation ID, membership version, sender ID, recipient ID, event ID, and sequence/replay state.
8. Persist the event in local conversation storage and update local transport state.
9. Write a signed/encrypted `receipt.delivered` event into senders inbox directory.
10. Delete the processed message file from that recipient's inbox.
11. If the conversation is open and the message has actually been presented to the user according to the UI's read
    rules, write a `receipt.read` event.

Persist the message before writing the receipt and deleting the inbox file. If the app crashes after persistence but
before the receipt or deletion, a later scan must detect the duplicate, avoid creating a second visible message, and
complete the missing receipt/cleanup steps.

A recipient deletes only its own inbox copy. It must never delete another participant's inbox copy.

## 10. Delivery and read receipts

### 10.1 Receipt content

A receipt should include:

- Original event ID.
- Conversation ID.
- Receipt sender/participant ID.
- Receipt type: `delivered` or `read`.
- Membership version.
- Timestamp or logical receipt sequence.

Receipts must be signed by the participant generating them and encrypted to the original sender. The sender verifies the
signature and records the receipt locally before deleting the receipt transport file.

### 10.2 Checkmark semantics

Use WhatsApp-like visual semantics, with an explicit distinction between local transport write and recipient
confirmation:

- **One grey checkmark — Sent:** the app successfully committed the encrypted message file to the local transport
  adapter. This does not prove that Google Drive has uploaded it or that any recipient can see it.
- **Two grey checkmarks — Delivered:** the recipient's app has verified and persisted the message locally and sent a
  valid delivery receipt.
- **Green checkmarks — Read:** the recipient's app has sent a valid read receipt after the message was actually
  displayed under the app's read-state rules.

Because the app has no server-side visibility into Google Drive synchronization, the one-grey-check state is only a
local handoff confirmation. The UI should not imply cloud upload completion.

### 10.3 Group receipt state

For group messages, delivery and read status are per participant. The aggregate status should not claim that everyone
has received or read the message until receipts have arrived from all intended recipients in the applicable membership
version.

Provide a details view such as:

- Delivered: 2 of 3 participants.
- Read: 1 of 3 participants.

The message can display the aggregate checkmark state, but users must be able to inspect which participants have
delivered/read it. If participant removal is added in a later version, historical recipient sets must remain tied to the
membership version associated with each message.

## 11. Filesystem watching and recovery

Use Chokidar in the Google Drive folder adapter for prompt notification:

```js
const chokidar = require("chokidar");

const watcher = chokidar.watch(incomingDirectory, {
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200
    }
});

watcher.on("add", filePath => queueIncomingFile(filePath));
watcher.on("change", filePath => queueIncomingFile(filePath));
```

This is illustrative. Production code must handle watcher errors, directory replacement, permission changes, shutdown,
and queue backpressure.

**Filesystem notifications are an optimization, not the source of truth.** Perform full scans:

- At application startup.
- When the shared folder becomes available again.
- After watcher errors or folder reconfiguration.
- Periodically while running.
- On user request.

Scan for unprocessed message and receipt files and queue them for validation. Maintain a local index to reduce repeated
work, but periodically reconcile it against the directory.

Ignore temporary suffixes such as `.tmp`. Enforce file-size limits before reading. Retry likely incomplete files.
Quarantine permanently invalid files locally, not in the shared folder. Record safe diagnostic codes without plaintext.

### 11.1 Duplicate and conflict handling

A synchronization provider may duplicate files, reorder their arrival, or create conflict copies. Do not assume
filenames alone are sufficient for deduplication. Validate the envelope and deduplicate by authenticated event ID plus
recipient ID.

A recipient may receive the same logical event more than once because the sender retries after not seeing a receipt.
Duplicate processing must not create a second visible message; it should complete any missing receipt and cleanup steps.

## 12. Transport abstraction and future providers

Chat/domain logic must not depend directly on Google Drive, Chokidar, or a specific local folder layout. Define a
provider-independent transport interface and implement Google Drive for Desktop as the first adapter.

Conceptual TypeScript interface:

```ts
type TransportEntry = {
    path: string;
    size?: number;
    modifiedAt?: number;
};

type TransportChange = {
    path: string;
    kind: "created" | "changed" | "deleted";
};

interface FileSyncTransport {
    initialize(config: unknown): Promise<void>;

    start(onChange: (change: TransportChange) => void): Promise<void>;

    stop(): Promise<void>;

    list(relativeDirectory: string): Promise<TransportEntry[]>;

    read(relativePath: string): Promise<Uint8Array>;

    writeAtomic(relativePath: string, data: Uint8Array): Promise<void>;

    delete(relativePath: string): Promise<void>;
}
```

The final interface may differ, but it must express the operations the domain layer needs without exposing
provider-specific APIs.

### 12.1 Transport contract

Every adapter must document and meet these semantic expectations, or explicitly report where it cannot:

- Files may arrive late, more than once, or out of order.
- Change notifications may be missed; listing/scanning must be available for reconciliation.
- A successful local write does not necessarily mean remote delivery.
- Files are immutable after publication; updates are new files/events.
- Reads may temporarily fail while a file is being synchronized.
- Deletes may propagate asynchronously.
- The adapter must prevent path traversal and restrict operations to the configured conversation root.
- The adapter must expose errors without leaking message plaintext or cryptographic secrets.

The chat layer owns event IDs, encryption, signatures, retries, deduplication, receipts, membership, and delivery/read
state. The adapter owns file movement, local observation, and provider-specific behavior.

### 12.2 Initial Google Drive for Desktop adapter

The generic folder adapter operates on a user-selected local folder and can be used with any synchronization product
that exposes a local folder. The optional Google Drive for Desktop adapter uses the same implementation pattern. It
uses:

- Node filesystem operations for reads and writes.
- Atomic temporary-file writes followed by rename where supported.
- Chokidar for local change notifications.
- Startup and periodic full scans.
- No Google API calls, OAuth tokens, or direct Google account access.

Future adapters may use other file synchronization products or a different file-transfer mechanism, provided they
implement the same transport contract. Do not allow Google-specific assumptions to leak into the conversation or
cryptography layers.

## 13. Google Drive for Desktop setup and supported configuration

### 13.1 Streaming versus mirroring (Google Drive adapter only)

Google Drive for Desktop has two principal ways to expose **My Drive** files:

- **Streaming:** files are primarily stored in the cloud and appear in a virtual drive on the computer. Files use local
  storage when accessed or explicitly made available offline. In streaming mode, offline files generally require Drive
  for Desktop to be running and the account to remain connected.
- **Mirroring:** a full local copy of My Drive files is kept on the computer as well as in the cloud. Files are
  available offline by default, but use local disk space.

Google's documentation explains the differences and how to make streamed files/folders available offline:

- [Stream and mirror files with Drive for desktop](https://support.google.com/drive/answer/13401938)
- [Manage Drive for desktop and open files/folders offline](https://support.google.com/drive/answer/16631477)

A shared folder's exact location and offline behavior can depend on how it is shared and exposed in the participant's
Drive. Do not assume every shared folder can be mirrored as part of My Drive. In streaming mode, users may need to mark
the conversation folder as **Available offline**. Confirm that this setting applies to the shared folder and to new
files subsequently added to it.

### 13.2 Recommended initial configuration

For the first implementation:

1. Support the current stable Google Drive for Desktop release for Windows, rather than pinning the application to a
   hard-coded old version.
2. Recommend streaming mode with the conversation root folder explicitly marked **Available offline**, if that option is
   available for the shared folder.
3. If the user's shared-folder configuration supports mirroring and the folder is actually mirrored locally, that can
   also be supported after testing.
4. Require the user to verify that the folder is visible and writable in Windows File Explorer.
5. On setup, perform a write/read/delete test using a temporary test file in a dedicated application test directory. Do
   not use a real message file for this test.
6. Warn that streamed offline content may not be accessible if Drive for Desktop is closed or the account is
   disconnected.
7. Revalidate the folder path and access on application startup.

Do not promise offline availability based solely on the folder appearing in File Explorer. The application should test
actual read/write behavior and continue to show delivery as pending until recipient receipts arrive.

### 13.3 Version policy and testing

Do not hard-code a specific Drive for Desktop version number into the protocol. Google updates the client independently
of this application. Support the current stable Windows release and test the application's transport adapter against:

- The current stable release at the time of each application release.
- The previous release where practical.
- Streaming with the conversation folder marked available offline.
- Streaming without offline pinning, to confirm that the application handles unavailable files safely.
- Mirrored My Drive, only where the shared-folder configuration supports it.
- Drive paused, signed out, disconnected, restarted, and updated.

If Google changes local mount behavior or shared-folder support, update the adapter and setup guidance rather than
changing the chat/domain protocol.

## 14. Offline behavior and status

| Situation                             | Expected behavior                                                                                          |
|---------------------------------------|------------------------------------------------------------------------------------------------------------|
| Sender and recipient online           | Delivery follows provider synchronization and recipient processing.                                        |
| Sender online, recipient offline      | After the recipient-specific file reaches the provider, it waits until the recipient reconnects and syncs. |
| Sender offline before synchronization | The outgoing file remains local until the sender reconnects.                                               |
| Both offline                          | No transfer occurs.                                                                                        |
| Provider sync paused/unavailable      | Messages remain pending; delivery is not confirmed.                                                        |
| Shared-folder permission revoked      | Synchronization may stop; report a transport/permission problem.                                           |
| Recipient processes a message         | Recipient writes a receipt and deletes only its own inbox copy.                                            |

The application cannot reliably know that an outgoing file reached Google's servers. Do not equate “written to local
folder” with “uploaded” or “delivered.”

## 15. Local persistence

Use the existing local conversation storage for visible conversation data where practical. The repository was not
included with this document, so the exact current storage format must be established by inspecting the application code
before implementation. Do not invent a migration or replace the existing format without that inspection.

A separate local SQLite database is a proposed option for transport state:

- `outgoing_events` — event ID, recipient ID, local envelope/path, creation time, retry state.
- `processed_events` — event ID, sender, recipient, sequence, local persistence status.
- `receipts` — event ID, participant ID, delivered/read status, local processing state.
- `peer_state` — verified public keys, fingerprints, last accepted sequence.
- `membership_state` — verified manifest version and participant roster.
- `scan_state` — last successful scan and reconciliation metadata.

Never sync this SQLite database through the file transport. Do not place a live database in the shared folder. Use
transactions for local state transitions and make processing idempotent.

## 16. Images and attachments

Do not introduce a new generic attachment system in this revision. The requirement is that existing image handling does
not change.

Before implementation, inspect the current code to determine how images are stored, displayed, and referenced. Preserve
that behavior. If existing image data is already stored outside the conversation message text, ensure that the relevant
references remain valid across participants; do not assume that local-only image paths will work on another
participant's computer. Any change to image transport must be designed as a separate requirement rather than silently
added here.

No new attachment retention policy or attachment-size policy is defined by this document.

## 17. Message immutability and transport-file cleanup

V1 does not support user-visible message edits or deletions. Once a message is sent, its content is immutable in the
conversation history. Do not implement edit controls, delete controls, edit events, or deletion tombstones.

This restriction does not prohibit protocol-level cleanup of transport files:

- A recipient deletes its own message transport file after successful local persistence and after writing the delivery
  receipt.
- The sender deletes a receipt transport file after validating and persisting it locally.
- The sender retains its local outbox copy according to local storage policy.
- Do not delete another participant's inbox file.
- Cleanup must be scoped to the participant's own inbox or receipt files and must be safe under delayed synchronization.
- There is no age-based retention policy specified for local conversation history.

Transport cleanup is not a user-visible message deletion and must not remove the message from local conversation
history. Because transport deletes may propagate asynchronously, a sender may not see a receipt before the corresponding
inbox deletion becomes visible. Keep the local outbox copy and retry safely when a valid receipt has not arrived.
Recipient event-ID deduplication ensures that a re-delivered event does not create a duplicate visible message.

## 18. Electron security boundaries

Recommended settings:

```js
const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, "preload.js")
};
```

Also:

- Use a restrictive Content Security Policy.
- Expose only narrow, typed IPC methods through preload.
- Validate every IPC argument in the main process.
- Keep filesystem access, cryptography, and private keys in the main or utility process.
- Do not expose arbitrary filesystem APIs to the renderer.
- Do not load remote content into privileged windows.
- Treat all synchronized files as untrusted input.
- Enforce limits on file size, nesting depth, string length, and payload structure.
- Prevent path traversal and restrict transport paths to the configured conversation root.
- Keep logs free of plaintext, private keys, and sensitive metadata.

## 19. Threat model and privacy

### Protected against, assuming sound cryptography and secure endpoints

- A synchronization provider reading plaintext message contents from encrypted event files.
- Unauthorized modification of an event without detection.
- Forged messages from an identity whose signing key has not been compromised.
- Accidental duplicate delivery creating duplicate visible messages.

### Not protected against

- Malware or an attacker controlling a participant's endpoint.
- A participant intentionally sharing plaintext.
- Private-key compromise.
- Traffic analysis and metadata observation by Google or another provider.
- Deletion, withholding, delay, or corruption of files by the provider or a participant with folder access.
- Denial of service through quota exhaustion, permission changes, or sync suspension.
- Forward-secrecy failures; forward secrecy is not part of v1.
- A removed participant retaining messages or files already received.

Encryption protects message contents, not all metadata. Providers may still see account/folder relationships,
participant folder structure, file sizes, timestamps, and synchronization patterns.

## 20. Error handling and user experience

Provide clear status and recovery guidance for:

- Shared root folder missing, unavailable, read-only, or not writable.
- Drive for Desktop unavailable, paused, signed out, or disconnected (where detectable).
- Shared folder not available offline.
- Permission revoked or folder removed.
- Unknown participant or fingerprint mismatch.
- Invalid signature or malformed envelope.
- Repeated incomplete-file retries.
- Local storage failure.
- Participant membership changes.
- Partial send success (some group recipients' files written, others pending).

Provide a manual **Rescan shared folder** action. Temporary synchronization problems should not be treated as data loss.

## 21. Chat initiation and participant onboarding

The proposed folder-assisted initiation sequence is:

1. **Initiator creates and shares the transport folder.** The initiator creates a folder using the selected
   synchronization provider and shares it with intended participants using that provider's normal UI. This step is
   optional when using manual file exchange or local-only mode.
2. **Participants prepare public keys.** Each participant generates their identity keys locally. Users exchange or place
   only public signing/encryption keys and participant identifiers where the onboarding flow instructs them. Private
   keys never leave the participant's device. Users perform these steps manually; the application guides them.
3. **Initiator creates a new chat.** The initiator opens the BranchChat wizard, selects **New chat**, chooses one-to-one
   or group, and selects/configures the chosen transport.
4. **Initiator reviews candidate public keys.** The application presents discovered/submitted public-key bundles. For
   v1, shared-folder access is sufficient to consider a key during bootstrap, but the initiator must be able to discard
   an unwanted candidate.
5. **Initiator creates invitations.** Each invitation is encrypted to its invitee's public encryption key. No separate
   invitation delivery channel is required by the current decision.
6. **Participants accept invitations.** Each participant uses **Join chat from invitation**, configures or selects the
   transport, and imports the invitation and current BranchChat file.
7. **Participants obtain the current BranchChat file.** The initiator shares the file for initial setup. After
   initiation, all participants are equal and any participant may share their local updated BranchChat file.
8. **Chat becomes ready.** The conversation becomes active when every intended participant can read the messages.
   The application should show which participants are able to access/read the conversation data, subject to the existing
   read-state model.

The application guides users through manual folder/key preparation and manual BranchChat file sharing when required.
It must not upload private keys. The remaining protocol details are listed in Section 22.

## 22. Open questions requiring decisions

The following points are not fully determined by the decisions recorded so far. They must be resolved against the
existing application code before implementation; do not invent a replacement BranchChat protocol to fill these gaps.

1. **Exact BranchChat schema and compatibility.** The existing format should be preserved as closely as possible and
   reviewed when the application code is available. The currently supplied format information includes read state, a
   manifest (`format`, `schemaVersion`, `documentId`, `createdAt`, `generator`), and discussion data (`title`,
   `participants`, `threads`, `messages`). Which exact fields and update semantics are authoritative in the current
   code, and which version-compatibility rules must the new implementation preserve?

2. **Rejoining with a replaced key pair.** A returning participant keeps their existing participant ID but has new
   signing/encryption keys; a genuinely new participant receives a new ID. How is the new public key bound to the
   existing participant ID and accepted by other participants? How should the returning participant's inability to
   decrypt old envelopes addressed to the lost key be represented in the UI?

3. **Invitation authenticity and replay handling.** Invitations are encrypted to the invitee's public key and no extra
   protection/channel is required. Is the existing message-signature mechanism also used to authenticate invitations?
   What minimum replay/duplicate handling is required by the current application format?

4. **Adding participants after activation.** Any participant may share their local BranchChat file and participants are
   equal after initiation. Does any participant have authority to add a new participant by issuing/sharing an
   invitation, or must the addition be initiated through a particular flow? How do existing participants learn that the
   new roster is accepted?

5. **BranchChat file divergence and update conflicts.** Multi-writer/admin authority is not part of the intended model.
   The expected behavior is the existing application's normal behavior or manually sharing a BranchChat file. What
   should the application do if two participants independently update their local copies before either receives the
   other's copy: accept the latest manually shared file, require user selection, merge supported fields, or reject one?
   Define this only after inspecting the existing update behavior.

6. **Meaning of the activation condition.** The conversation becomes active as soon as every participant can read the
   messages. Does this mean every invited participant has successfully imported the current BranchChat file and can
   access the shared message location, or is another existing application state the definitive signal?

7. **Immutable metadata versus participant additions.** Conversation metadata and participant/display-name changes are
   not supported after creation, while adding a participant after activation is supported. Confirm exactly which fields
   are immutable and how the supported participant-addition operation changes the roster without allowing other metadata
   edits.

8. **Read receipt policy.** Read receipts are mandatory. Confirm whether the existing application already defines when a
   message is considered read (for example, visible in an open conversation) and whether any existing per-user
   read-state behavior needs to be preserved. V1 should not expose a disable-read-receipts setting unless the existing
   product behavior requires it.

9. **Manual file exchange and local-only mode.** The intended non-Google options are the generic local-folder adapter
   and local-only/manual operation. The existing behavior is described as updating only the BranchChat file and then
   sharing that file manually between users. Confirm whether this is the complete manual exchange workflow, including
   how message events and updated files are transferred, or whether it applies only to conversation-state updates.

10. **Participant bootstrap details.** Users perform folder sharing and public-key exchange manually, guided by the app.
    Confirm the exact public-key bundle format and where users place or select it during bootstrap after the current
    implementation has been inspected.

## 23. Decisions and implementation notes

The following requirements are treated as settled for this revision. Remaining questions are listed in Section 22.

1. **BranchChat file:** preserve the existing format as closely as possible. Inspect the application code before
   changing
   the schema or serialization. Current supplied format details are summarized in Section 3.3.
2. **Initial participant trust:** for v1, access to the shared folder is sufficient to consider a discovered public key
   during bootstrap. The initiator must be able to discard/reject a candidate public key.
3. **Invitations:** encrypt each invitation to the invitee's public encryption key. No separate delivery channel or
   additional confidentiality layer is required by the current decision.
4. **Participant authority:** the initiator performs initial setup. After that, participants are equal; there is no
   administrator role or permanent single-writer authority. Any participant may share their local BranchChat file.
5. **Membership:** participants cannot leave or remove other participants in v1. A participant may be added after the
   conversation is active.
6. **Rejoining:** a returning participant retains their existing participant ID; a genuinely new participant receives a
   new ID. A new invitation contains the current chat state. Replaced-key binding and historical ciphertext limitations
   remain subject to Section 22.
7. **Transport choices:** v1 includes the generic local-folder adapter and local-only/manual operation. Google Drive for
   Desktop is an optional use of the local-folder adapter, not a required integration. No other named provider is in v1.
8. **Manual setup:** users manually create/share folders and exchange the required files/keys; the application guides
   them through the process.
9. **Activation:** the conversation becomes active when every participant can read the messages.
10. **Metadata:** conversation metadata and participant/display-name changes are not supported after creation, subject
    to
    the participant-addition behavior described in Section 22.
11. **Read receipts:** read receipts are mandatory in v1.
12. **Cryptographic construction:** use libsodium sealed boxes for a separate encrypted copy to each recipient, with
    Ed25519 signatures for sender authentication. Review the exact implementation and add protocol test vectors before
    production.
13. **Forward secrecy:** not required for v1. Document the limitation of static recipient encryption keys.
14. **Key backup/recovery:** no private-key recovery workflow is required for v1. A user who loses private keys
    generates
    a new key pair and rejoins through a new invitation. The new key cannot decrypt historical messages addressed to the
    lost key unless the existing application has retained usable local history/key material.
15. **Existing conversation storage:** inspect the current application code and preserve the existing format where
    practical. Do not assume a migration or replacement format.
16. **Attachments and retention:** no new attachment or attachment-retention system. Existing image handling remains
    unchanged. No age-based retention policy is introduced for local conversation history.
17. **Google Drive for Desktop configuration:** support the current stable Windows release. Prefer streaming with the
    shared conversation folder marked Available offline, if supported for that folder; support mirroring only where the
    shared folder is actually mirrored and tested. See Section 13.
18. **Delivery/read UI:** use one grey checkmark for local transport write, two grey checkmarks for recipient
    persistence/delivery, and green checkmarks for read receipts. The local sent state does not confirm cloud upload.
    For
    groups, show per-participant counts/details.
19. **Transport-file cleanup:** each recipient deletes its own inbox message file after processing and writing a
    delivery
    receipt. The sender deletes receipt files after processing them. This is transport cleanup only; v1 has no message
    edit/delete feature. See Section 17.
20. **Group conversations:** use the existing shared conversation root and participant-specific inboxes/receipt areas.
    Sender writes one recipient-specific encrypted copy to each other participant.
21. **Future transports:** use the provider-independent `FileSyncTransport` abstraction in Section 12. Google Drive for
    Desktop is an optional adapter.

## 24. Testing plan

### Functional tests

- Verify that importing/sharing an updated BranchChat file preserves the existing format and does not corrupt local
  conversation data.
- Complete the main-menu wizard for both one-to-one and group chat creation.
- Complete the join-from-invitation wizard on a clean participant installation.
- Verify a user can lose the old private keys, generate a new identity, receive a new invitation, and receive future
  messages; verify the new identity cannot decrypt old ciphertext.
- Verify no leave-chat, message-edit, or message-delete controls/actions exist in v1.
- Verify the app can start and use local-only mode without Google Drive installed.
- Verify a non-Google transport adapter can be configured without changing conversation/domain logic.
- Pair two clean Windows installations and exchange messages in both directions.
- Create a group with at least three participants.
- Verify each recipient receives its own encrypted copy.
- Verify a participant cannot decrypt another participant's envelope.
- Verify signatures, sender identity, membership version, and recipient checks.
- Verify delivery and read receipts, including partial group delivery.
- Verify a recipient deletes only its own inbox copy.
- Verify duplicate files/retries do not create duplicate visible messages.
- Verify participant addition behavior; verify that participant removal is not offered or supported in v1.

### Offline and synchronization tests

- Recipient offline while sender sends.
- One group member offline while other members receive the same group message.
- Sender offline before a file synchronizes.
- All participants offline.
- Pause/restart/re-authenticate Drive for Desktop.
- Streaming with conversation folder marked available offline.
- Streaming without offline pinning.
- Mirroring where supported for the shared folder.
- Folder unavailable or path/drive letter changed.
- Permission revoked and restored.
- Delayed, reordered, duplicated, and conflict-copy files.

### Reliability tests

- Terminate the app during a file write.
- Terminate after persisting an incoming message but before writing a receipt.
- Terminate after writing a receipt but before deleting the inbox file.
- Terminate after deleting the inbox file but before updating local state.
- Partial group send where only some recipient writes succeed.
- Miss watcher events and verify full scans recover.
- Restart Windows and verify startup reconciliation.
- Verify cleanup does not delete another participant's inbox files.

### Security tests

- Modify ciphertext or signed metadata and verify rejection.
- Replay old events.
- Inject malformed and oversized files.
- Test path traversal and hostile filenames/payloads.
- Test unknown keys and rejected candidate public keys during bootstrap.
- Verify private keys and plaintext never appear in shared folders or logs.
- Verify participant removal is not supported in v1.

## 25. Implementation milestones

### Milestone 1 — Inspect current application and define interfaces

- Inspect the existing BranchChat file schema and preserve its format and behavior wherever practical.
- Define the invitation format and the bootstrap flow, including how the initiator rejects unwanted discovered public
  keys.
- Define rejoin behavior when a participant has a new key pair but retains their participant ID.
- Inspect existing conversation storage and image handling.
- Identify where domain logic currently lives.
- Define participant, conversation, event, receipt, and membership models.
- Define the provider-independent transport interface.
- Define the shared-root layout and path validation rules.

### Milestone 2 — Initial file transport

- Implement a generic local-folder transport adapter that does not depend on Google Drive.
- Implement Google Drive for Desktop as an optional adapter.
- Add folder selection and configuration.
- Implement atomic file writes, reads, listing, and scoped deletion.
- Implement Chokidar notifications and startup/periodic scans.
- Add local transport-state persistence.
- Test with non-sensitive dummy events.

### Milestone 3 — Identity and cryptography

- Implement the existing BranchChat file import/share behavior and encrypted invitations.
- Implement Ed25519 signing and Curve25519 sealed-box encryption using libsodium.
- Implement protected local key storage.
- Implement the guided manual public-key exchange and candidate-key review flow.
- Implement recipient-specific encrypted envelopes.
- Add protocol versioning, canonical serialization, and test vectors.

### Milestone 4 — Multi-participant reliable messaging

- Implement participant addition and propagation of updated BranchChat files.
- Implement per-recipient outbox writes.
- Implement incoming processing, deduplication, and recipient-owned cleanup.
- Implement authenticated delivered/read receipts.
- Implement aggregate group status and per-participant details.
- Add crash recovery and partial-send retry behavior.

### Milestone 5 — Product integration and release

- Build the main-menu create-chat/join-chat wizard for one-to-one and group conversations, including key-generation
  guidance.
- Integrate with existing conversation storage without changing image handling.
- Add checkmark states and group receipt details.
- Test supported Drive for Desktop configurations.
- Run failure-injection and security tests.
- Document setup, limitations, and recovery after key loss.
- Keep provider-specific behavior inside the Google Drive adapter.

---

## Appendix A — Important implementation cautions

- Google Drive for Desktop is a general file-synchronization client, not a messaging transport protocol. Its timing and
  local-folder behavior are not guaranteed to match chat requirements.
- Test shared-folder behavior on real Windows installations before committing to this architecture.
- Never infer cloud upload completion from local file existence.
- Never rely exclusively on filesystem watcher events.
- Never modify an event file after publishing it.
- Never treat folder membership as sender authentication.
- Never store private keys or plaintext in the shared folder.
- Never synchronize the live SQLite database.
- Never let one recipient delete another recipient's inbox file.
- Never couple conversation logic directly to Google Drive or Chokidar.
- Never invent a cryptographic protocol; use the selected libsodium constructions as documented and obtain a security
  review before handling sensitive conversations.
