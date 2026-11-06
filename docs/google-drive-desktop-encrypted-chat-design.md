# Design: Private Group Chat over a File-Synchronization Transport

**Status:** Proposed  
**Platform:** Windows desktop  
**Initial transport:** Manually shared folders synchronized by Google Drive for Desktop  
**Backend:** None  
**Google integration:** No Drive API, OAuth flow, or app-managed Google credentials

## 1. Overview

This document describes a Windows desktop chat application that exchanges messages through files synchronized between
participants' computers. The initial transport is a Google Drive folder that participants share manually and access
through Google Drive for Desktop.

A participant creates a shared root folder in Google Drive and invites the other participants using Google's normal
sharing UI. Each participant configures Google Drive for Desktop, makes the shared conversation folder locally
available, and selects its local path in the chat application.

The application treats the synchronized folder as an **untrusted, eventually consistent file transport**. It writes
immutable encrypted event files and discovers incoming files using filesystem notifications plus periodic scans. The
application does not communicate directly with Google Drive and does not handle Google credentials.

The design must support:

- One-to-one conversations.
- Group conversations with multiple participants sharing the same root folder.
- Future file-synchronization providers without coupling chat logic to Google Drive or a particular filesystem watcher.

A message can be delivered while its recipient is offline only after its encrypted file has reached the synchronization
provider. It then waits for that recipient's client to reconnect and synchronize. There is no guarantee of immediate
delivery or a reliable way for this application to know when a locally written file has reached Google's servers.

## 2. Goals and non-goals

### Goals

- Windows desktop application built with Electron, Node.js, and React.
- One-to-one and multi-participant conversations.
- No application-operated server or hosting cost.
- No Google Drive API or OAuth integration.
- Participants manually create/share a root folder and configure its local path.
- End-to-end encryption and sender authentication.
- Offline recipient delivery after a message has synchronized to the provider.
- At-least-once transport with idempotent processing and recovery from missed events, duplicates, and sync delays.
- A transport abstraction that allows other file-synchronization implementations to be added later.
- Preserve existing local conversation storage and image handling where practical.

### Non-goals and limitations

- No anonymity from Google or another synchronization provider. Providers can observe account relationships, folder
  membership, file metadata, sizes, timestamps, access patterns, and approximate traffic volume.
- No guarantee of immediate delivery.
- No reliable indication that a locally written file has reached the cloud.
- No protection against a participant copying, exporting, photographing, or otherwise sharing plaintext.
- No guaranteed deletion from backups, screenshots, exports, or devices after a delete event.
- No multi-device identity support in the initial implementation.
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
7. **Transport abstraction:** a provider-independent interface for writing, reading, listing, watching, and deleting
   transport files.
8. **Initial transport adapter:** Google Drive for Desktop local-folder implementation, using Chokidar for filesystem
   notifications and full scans for recovery.

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
  +--> Google Drive for Desktop folder adapter (initial)
  |
  +--> Future file-sync adapter(s)
```

For each recipient, the transport adapter writes an independently encrypted copy to that recipient's inbox. The
recipient processes and deletes only its own inbox copy. This avoids one group participant deleting a shared message
file before the other participants have received it.

## 4. Participants, conversations, and membership

### 4.1 Shared root

Each group has one shared root folder. All participants must have sufficient permissions to create and delete files
within the root. The application creates a participant-specific directory for each member.

The root folder is a transport location, not an authority for identity. A person gaining access to the folder must not
automatically be trusted as a valid participant.

### 4.2 Participant identity

Each participant has:

- A stable application-level participant ID.
- An Ed25519 signing public/private key pair.
- A Curve25519 encryption public/private key pair.
- A verified key fingerprint.

For the initial version, use one identity and one device per participant. Device linking and multi-device identity are
outside the initial scope.

### 4.3 Membership and invitations

Participants exchange public identity information through an independent trusted channel and compare fingerprints before
accepting each other.

A conversation manifest should identify:

- Conversation ID.
- Conversation creator/administrator.
- Current participant IDs.
- Each participant's public signing and encryption keys.
- Manifest version.
- Membership version or epoch.

The initial implementation should use a clearly defined membership authority. A practical first version is for the
conversation creator to sign membership changes. Adding a participant creates a new signed manifest version. Removing a
participant prevents that participant from receiving future message copies, but cannot revoke content already received
or copied.

Do not accept an unsigned participant list merely because it appears in the shared folder. Validate the manifest
signature and the public-key fingerprints.

## 5. Shared-folder layout

Use participant-specific inboxes and receipt directories. Each sender writes a separate encrypted event copy into each
intended recipient's inbox.

```text
Shared Conversation/
  conversation/
    participants/
      <participant-id-A>/
        inbox/
          <event-id>.bcmsg
      <participant-id-B>/
        inbox/
      <participant-id-C>/
        inbox/
```

The sender writes message files to the inbox of each other participant in the current conversation roster. 
A participant writes its own receipt files in the inbox directory of a sender. A recipient deletes a message file from its own inbox
after it has successfully processed and persisted that event locally and has written the corresponding delivery receipt.

The sender processes receipt files and deletes each receipt file after it has been safely recorded locally. The sender
must retain its local outbox copy until the required delivery/read state has been reached or the user explicitly removes
it.

Use opaque IDs and generic filenames. Do not put message text, contact names, private keys, plaintext, local databases,
logs, or decrypted image data in the shared folder.

**Permissions requirement:** the folder-sharing configuration must allow each participant to create and delete files in
the shared root. Verify this with the actual Google Drive sharing configuration used by the application. If participants
cannot write to each other's inbox paths, this layout will not work without changing the folder structure or
permissions.

## 6. Event model and serialization

Treat the shared folder as an append-only event transport. Do not edit a previously published message event. An edit or
deletion is a new event referencing an earlier event.

For a group message, the logical event has one event ID and one recipient-specific encrypted transport envelope per
recipient. The plaintext event can be the same for all recipients; the encrypted envelope is generated separately for
each recipient and includes that recipient's ID.

Initial event types:

- `message.sent`
- `receipt.delivered`
- `receipt.read`

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
previously verified public key. The signature must cover all security-relevant event fields, including protocol version,
event ID, conversation ID, membership version, sender ID, recipient ID, sequence number, event type, and payload.

This approach is straightforward for small groups because the sender creates one encrypted copy per recipient. Its cost
grows linearly with the number of recipients and message size. It avoids inventing a custom group-key protocol.

Use the exact libsodium API and key formats documented by the library. Add protocol test vectors and negative tests. Do
not treat successful decryption as proof of sender identity; verify the signature separately.

### 7.2 Limitations

Sealed boxes do not provide forward secrecy against later compromise of a recipient's long-term private encryption key.
Forward secrecy is explicitly **not required for v1**. Document this limitation rather than introducing a custom
ratchet.

A participant removed from a group must not receive new message copies, but can retain old messages and keys. Removing a
participant does not erase previously delivered data.

### 7.3 Key storage and lifecycle

- Keep private keys out of the renderer.
- Protect local private keys using Windows DPAPI or an appropriate Windows secure key-storage mechanism.
- Restrict access to key material and application data.
- Never log keys, plaintext, or decrypted payloads.
- No key backup/recovery workflow is required for the initial version. Make the consequence explicit: loss of the local
  private keys may make the participant unable to decrypt future messages and may require creating a new identity.
- Device-loss revocation/replacement is not in the initial scope. Membership changes can exclude the old identity from
  future messages, but cannot invalidate old content or keys already copied.

Signatures and encryption do not by themselves prevent replay. Track processed event IDs, sender sequence state,
conversation ID, and membership version locally.

## 8. Outgoing message flow

1. User creates a message.
2. Conversation layer determines the current recipient set from the verified conversation manifest.
3. Main process validates the request and creates a unique event ID and sender sequence number.
4. Serialize the logical event canonically.
5. Sign the event with the sender's signing key.
6. For each recipient, create a sealed-box encrypted envelope using that recipient's public encryption key.
7. Save the logical event and recipient-specific outgoing envelopes in the local outbox/state database.
8. Write each envelope to a temporary file in local tmp directory.
9. Flush and close each file, then rename/move it to its final `.bcmsg` filename at the recepient inbox location.
10. Mark the local transport write as complete for that recipient.
11. Wait for signed delivery/read receipts from recipients.

Atomic local rename/move reduces the chance of observing a partial local write. It does not guarantee atomic publication by
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
delivered/read it. A participant who has left the group or was removed should be handled according to the membership
version associated with the message; do not silently change the historical recipient set.

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

The first adapter operates on a user-selected local folder. It uses:

- Node filesystem operations for reads and writes.
- Atomic temporary-file writes followed by rename where supported.
- Chokidar for local change notifications.
- Startup and periodic full scans.
- No Google API calls, OAuth tokens, or direct Google account access.

Future adapters may use other file synchronization products or a different file-transfer mechanism, provided they
implement the same transport contract. Do not allow Google-specific assumptions to leak into the conversation or
cryptography layers.

## 13. Google Drive for Desktop setup and supported configuration

### 13.1 Streaming versus mirroring

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

## 21. Decisions and implementation notes

The following decisions incorporate the answers supplied in the revised source document.

1. **Cryptographic construction:** use libsodium sealed boxes for a separate encrypted copy to each recipient, with
   Ed25519 signatures for sender authentication. Review the exact implementation and add protocol test vectors before
   production.
2. **Forward secrecy:** not required for v1. Document the limitation of static recipient encryption keys.
3. **Key backup/recovery:** no recovery workflow is required for v1. Loss of a private key may require a new identity
   and re-pairing.
4. **Key revocation/device loss:** out of scope for v1. Removing an identity from the signed membership manifest
   prevents future delivery but does not revoke already received content.
5. **Existing conversation storage:** inspect the current application code and infer the existing format before
   implementation. This document does not assume a particular format.
6. **Attachments and retention:** no new attachments or attachment retention system. Existing image handling remains
   unchanged. No age-based retention policy is introduced for local conversation history.
7. **Google Drive for Desktop configuration:** support the current stable Windows release. Prefer streaming with the
   shared conversation folder marked Available offline, if supported for that folder; support mirroring only where the
   shared folder is actually mirrored and tested. See Section 13.
8. **Delivery/read UI:** use one grey checkmark for local transport write, two grey checkmarks for recipient
   persistence/delivery, and green checkmarks for read receipts. The local sent state does not confirm cloud upload. For
   groups, show per-participant counts/details.
9. **Transport-file cleanup:** each recipient deletes its own inbox message file after processing and writing a delivery
   receipt. The sender deletes receipt files after processing them. See Section 17.
10. **Group conversations:** all participants share the same conversation root. Each participant has a dedicated inbox
    and receipt area. Sender writes one recipient-specific encrypted copy to each other participant.
11. **Future transports:** use the provider-independent `FileSyncTransport` abstraction in Section 12. Google Drive for
    Desktop is only the first adapter.

## 22. Testing plan

### Functional tests

- Pair two clean Windows installations and exchange messages in both directions.
- Create a group with at least three participants.
- Verify each recipient receives its own encrypted copy.
- Verify a participant cannot decrypt another participant's envelope.
- Verify signatures, sender identity, membership version, and recipient checks.
- Verify delivery and read receipts, including partial group delivery.
- Verify a recipient deletes only its own inbox copy.
- Verify duplicate files/retries do not create duplicate visible messages.
- Verify membership addition/removal behavior.

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
- Test unknown keys and fingerprint mismatch.
- Verify private keys and plaintext never appear in shared folders or logs.
- Verify removed participants do not receive newly created message envelopes.

## 23. Implementation milestones

### Milestone 1 — Inspect current application and define interfaces

- Inspect existing conversation storage and image handling.
- Identify where domain logic currently lives.
- Define participant, conversation, event, receipt, and membership models.
- Define the provider-independent transport interface.
- Define the shared-root layout and path validation rules.

### Milestone 2 — Initial file transport

- Implement Google Drive for Desktop local-folder adapter.
- Add folder selection and configuration.
- Implement atomic file writes, reads, listing, and scoped deletion.
- Implement Chokidar notifications and startup/periodic scans.
- Add local transport-state persistence.
- Test with non-sensitive dummy events.

### Milestone 3 — Identity and cryptography

- Implement Ed25519 signing and Curve25519 sealed-box encryption using libsodium.
- Implement protected local key storage.
- Implement public-key exchange and fingerprint verification.
- Implement recipient-specific encrypted envelopes.
- Add protocol versioning, canonical serialization, and test vectors.

### Milestone 4 — Multi-participant reliable messaging

- Implement signed membership manifest and membership changes.
- Implement per-recipient outbox writes.
- Implement incoming processing, deduplication, and recipient-owned cleanup.
- Implement authenticated delivered/read receipts.
- Implement aggregate group status and per-participant details.
- Add crash recovery and partial-send retry behavior.

### Milestone 5 — Product integration and release

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
