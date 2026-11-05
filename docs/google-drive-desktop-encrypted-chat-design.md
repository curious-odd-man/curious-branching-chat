# Design: Private One-to-One Chat over Google Drive for Desktop

**Status:** Proposed  
**Platform:** Windows desktop  
**Stack:** Electron, Node.js, React  
**Transport:** Manually shared folders synchronized by Google Drive for Desktop  
**Backend:** None  
**Google integration:** No Drive API, OAuth flow, or app-managed Google credentials

## 1. Overview

Two participants exchange messages through a Google Drive folder that they share manually. Each installs and signs in to
Google Drive for Desktop. One participant creates a folder in Drive and shares it with the other. Both make the folder
available locally and select its local path in the chat application.

The application treats that directory as an untrusted file-delivery channel. It writes immutable encrypted event files
and watches for files written by the other participant. Google Drive for Desktop synchronizes those files between
computers. The application does not communicate directly with Google Drive.

This supports asynchronous delivery once a message has reached Google Drive: if the recipient is offline, the file can
wait in Drive until the recipient reconnects and synchronizes. There is no guarantee of immediate delivery or visibility
into cloud upload completion.

## 2. Goals and non-goals

### Goals

- Windows-only Electron desktop app using Node.js and React.
- One-to-one conversations.
- No app-operated server or hosting cost.
- No Google Drive API or OAuth integration.
- Users manually create/share the folder and select its local path once.
- End-to-end encryption and sender authentication.
- Offline recipient delivery after the message has synchronized to Drive.
- Recovery from missed filesystem events, duplicate files, and sync delays.
- Preserve existing local conversation storage where practical.

### Non-goals and limitations

- No anonymity from Google. Google can observe account relationships, folder membership, file metadata, sizes,
  timestamps, access patterns, and approximate traffic volume.
- No guarantee of immediate delivery.
- No reliable indication that a locally written file has reached Google's servers.
- No protection against a participant copying, exporting, or photographing plaintext.
- No guaranteed deletion from backups or devices after a delete event.
- No multi-device identity or group chat in the first release.
- No forward secrecy unless a reviewed ratcheting protocol is adopted.

## 3. Architecture

Each installation contains:

1. **React renderer:** UI only.
2. **Electron main process:** filesystem access, IPC validation, application coordination.
3. **Crypto module:** key handling, signing, encryption, decryption, and verification. Run in the main process or a
   utility process, not the renderer.
4. **Conversation storage:** existing local message/conversation files.
5. **Sync-state database:** local SQLite database for outbox, processed IDs, acknowledgments, and retry state. Never put
   this database in the shared folder.
6. **Folder transport:** Chokidar watcher plus startup and periodic full scans.
7. **Google Drive for Desktop:** installed and configured by the user; synchronizes the manually shared folder.

```text
Alice's app -> Alice's local shared folder
            -> Google Drive for Desktop
            -> Google Drive shared folder
            -> Bob's Google Drive for Desktop
            -> Bob's local shared folder -> Bob's app
```

The reverse direction uses a separate sender-owned directory.

## 4. User setup and pairing

### 4.1 Manual folder sharing

1. Alice installs Google Drive for Desktop and signs in.
2. Alice creates a folder in Google Drive.
3. Alice shares it with Bob using Drive's normal sharing UI.
4. Bob accepts the share and configures Drive for Desktop.
5. Both ensure the shared folder is available locally.
6. Each selects the local folder path in the application.
7. The application checks that it can read and write the required directories.

Drive for Desktop may offer streaming/mirroring or other availability behavior depending on version and configuration.
Verify how shared folders behave on supported Windows installations. Do not assume the entire shared folder is always
present offline.

### 4.2 Identity verification

Folder access is not proof of identity. Each user generates a long-term identity key pair locally. They exchange public
identity information over an independent trusted channel and compare a short fingerprint derived from each public key.

An invitation may contain a conversation ID, identity ID, public keys, protocol version, and fingerprint. It must never
contain private keys or permanent bearer secrets. Treat invitation files in the shared folder as untrusted until
fingerprints have been verified independently.

For the first release, support one identity and one device per participant. Multi-device support requires additional
device authorization and key distribution design.

## 5. Shared-folder layout

Each participant writes only to their own directories, avoiding concurrent modification of the same files.

```text
Shared Conversation/
  alice-to-bob/
    messages/
      <event-id>.msg
    acknowledgments/
      <event-id>.ack
  bob-to-alice/
    messages/
    acknowledgments/
```

Use generic folder and file names; do not expose message content or sensitive contact information in names. The folder
name and structure may be visible to Google.

Do not put private keys, plaintext messages, logs, caches, temporary decrypted attachments, or local files in
the shared folder.

## 6. Event model and serialization

Treat the shared folder as an append-only event transport. Never edit a previously published message file. A logical
edit or deletion is a new event referencing an earlier event.

Define a canonical serialization format, such as canonical CBOR or rigorously specified canonical
JSON. Do not sign arbitrary JSON without defining canonicalization.

Possible event types:

- `message.created`
- `message.edited` — references the original event ID.
- `message.deleted` — tombstone referencing the original event ID.
- `delivery.acknowledged`

Use random unique event IDs and per-sender logical sequence numbers. Do not rely on filesystem timestamps, Drive
timestamps, or arrival order to establish message order.

## 7. Cryptography

Candidate dependency:

```bash
npm install chokidar libsodium-wrappers-sumo
```

Select and document a reviewed cryptographic construction before implementation. Do not invent a protocol or assemble
primitives without review.

Potential primitives include Ed25519 signatures, X25519 key agreement, XChaCha20-Poly1305 authenticated encryption,
HKDF-SHA-256, SHA-256, and cryptographically secure random values. Prefer a reviewed authenticated public-key encryption
construction (for example, a sealed-box style construction where its limitations are acceptable) over a custom scheme.

The authenticated/signed data must bind all security-relevant context:

- Protocol and envelope version.
- Event ID and conversation ID.
- Sender and recipient identities.
- Event type and sequence number.
- Ciphertext and any required nonce/key identifiers.

Define exact byte encodings and use authenticated associated data where appropriate.

### Forward secrecy

Static public-key encryption does not provide forward secrecy. Compromise of a long-term private key may expose
previously captured messages, depending on the construction. If forward secrecy is required, adopt a reviewed ratcheting
protocol. This is a substantial increase in scope and should not be improvised. If deferred, document the limitation.

### Key storage and lifecycle

- Keep private keys out of the renderer.
- Protect local private keys with Windows DPAPI or an appropriate Windows secure key-storage mechanism.
- Restrict access to key files and application data.
- Never log keys or plaintext.
- Loss of a private key without recovery may make future messages addressed to it unreadable.

Signatures and authenticated encryption do not by themselves prevent replay. Track processed event IDs and sender
sequence state locally.

## 8. Outgoing message flow

1. User creates a message.
2. Main process validates the request and creates a unique event ID.
3. Serialize the event canonically.
4. Sign and encrypt the event.
5. Save the encrypted event to the local outbox/state database.
6. Write it to a temporary file in the sender's `messages` directory.
7. Flush and close the file, then rename it to its final `.bcmsg` filename.
8. Google Drive for Desktop detects and synchronizes the file.
9. Retain the outgoing event until a valid recipient acknowledgment arrives.

Atomic local rename reduces the chance of observing a partial local write. It does not guarantee atomic publication by
Google Drive or immediate availability to the recipient.

## 9. Incoming message flow

1. Watcher reports a possible filesystem change.
2. Wait briefly for the file to become stable.
3. Validate envelope structure and size limits.
4. If incomplete or temporarily unavailable, defer and retry.
5. Verify sender identity and signature.
6. Verify conversation and recipient identifiers.
7. Check event ID and sequence/replay state.
8. Decrypt and validate the event.
9. Persist it in local conversation storage and update sync state.
10. Create a signed and encrypted acknowledgment.
11. Write the acknowledgment into the receiver's own `acknowledgments` directory.

Persist the event before writing the acknowledgment. If the app crashes after persistence but before acknowledgment, the
next scan should detect the duplicate and resend the acknowledgment.

## 10. Acknowledgments and delivery semantics

An acknowledgment should include:

- Original event ID.
- Conversation ID.
- Acknowledging identity.
- Acknowledgment type, such as `persisted`.
- Timestamp or logical acknowledgment sequence.

Authenticate and encrypt acknowledgments. The sender marks a message delivered only after validating an acknowledgment
from the expected recipient that references the original event.

Define **Delivered** as “the recipient application verified and persisted the message locally.” It does not mean the
recipient read it.

Design for at-least-once delivery with idempotent processing:

- Watcher events can be duplicated or missed.
- Full scans can rediscover files.
- Drive may create conflict copies.
- Files may be downloaded again after reconnection.

Use the authenticated event ID as the deduplication key. A duplicate must not create a second visible message. Resend
its acknowledgment if necessary.

## 11. Filesystem watching and recovery

Use Chokidar for prompt notification:

```js
const chokidar = require("chokidar");

const watcher = chokidar.watch(incomingMessagesDirectory, {
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

**Filesystem events are an optimization, not the source of truth.** Perform full scans:

- At application startup.
- When the shared folder becomes available again.
- After watcher errors or folder reconfiguration.
- Periodically while running.
- On user request.

Scan for unprocessed `.msg` and `.ack` files and queue them for validation. Keep a local index to reduce repeated work,
but periodically reconcile it against the directory.

Ignore temporary suffixes such as `.tmp`. Enforce file-size limits before reading. Retry likely incomplete files.
Quarantine permanently invalid files locally, not in the shared folder. Record safe diagnostic codes without plaintext.

### Conflict copies

Drive may create conflict copies or duplicate local files. Do not assume filenames are globally unique. Deduplicate by
event ID inside the authenticated envelope. Never overwrite an existing event file to resolve a conflict.

## 12. Offline behavior and status

| Situation                        | Expected behavior                                                               |
|----------------------------------|---------------------------------------------------------------------------------|
| Both online                      | Delivery follows Drive synchronization and recipient processing.                |
| Sender online, recipient offline | Once uploaded to Drive, the message waits until recipient reconnects and syncs. |
| Sender offline before upload     | Message remains local until sender reconnects.                                  |
| Both offline                     | No transfer occurs.                                                             |
| Drive sync paused/unavailable    | Messages remain pending; delivery is not confirmed.                             |
| Share permission revoked         | Sync may stop; report a transport/permission problem.                           |

The application cannot reliably know that an outgoing file reached Google's servers without a Drive integration. Do not
equate “written to local shared folder” with “uploaded” or “delivered.”

Suggested UI states:

- **Sending:** queued or being written locally.
- **Waiting for sync:** file exists locally, but no recipient acknowledgment has arrived.
- **Delivered:** valid recipient acknowledgment received.
- **Failed / needs attention:** local write failed, folder unavailable, or persistent error needs user action.

Do not claim an upload state that the app cannot observe.

## 13. Local persistence

Use existing local conversation storage for visible conversation data where practical. Add a separate local SQLite
database for transport state.

Suggested tables:

- `outgoing_events` — event ID, local path, creation time, retry state, acknowledgment state.
- `processed_events` — event ID, sender, sequence, persistence status.
- `pending_acknowledgments` — original event ID, acknowledgment payload/path, write state.
- `peer_state` — verified public keys, fingerprints, last accepted sequence.
- `scan_state` — last successful scan and reconciliation metadata.

Never sync this SQLite database through Drive. Do not put a live database in the shared folder. Use transactions for
local state changes and make processing idempotent.

## 14. Electron security boundaries

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
- Treat synchronized files as untrusted input.
- Enforce limits on file size, nesting depth, string length, and payload structure.
- Keep logs free of plaintext, keys, and sensitive metadata.

## 17. Threat model and privacy

### Protected against, assuming sound cryptography and secure endpoints

- Google Drive reading plaintext from synchronized message files.
- Unauthorized modification of events without detection.
- Forged messages from an identity whose signing key has not been compromised.
- Accidental duplicate delivery creating duplicate visible messages.

### Not protected against

- Malware or an attacker controlling either endpoint.
- A participant intentionally sharing plaintext.
- Private-key compromise.
- Traffic analysis and metadata observation by Google.
- Deletion, withholding, delay, or corruption by the provider or a participant with folder access.
- Denial of service through quota exhaustion, permission changes, or sync suspension.
- Forward-secrecy failures if no ratcheting protocol is used.

Encryption protects message contents, not all metadata. Google may still see sharing relationships, file names, sizes,
timestamps, and synchronization patterns.

## 18. Error handling and user experience

Provide clear status and recovery guidance for:

- Shared folder missing, unavailable, read-only, or not writable.
- Drive for Desktop unavailable (if detectable).
- Sync delay or apparent pause (the app may not be able to determine the cause).
- Permission revoked or folder removed.
- Unknown sender or fingerprint mismatch.
- Invalid signature or malformed envelope.
- Repeated incomplete-file retries.
- Local storage failure.
- Key backup/recovery warning.

Provide a manual **Rescan shared folder** action. Temporary synchronization problems should not be treated as data loss.

## 21. Open decisions

1. Which reviewed public-key encryption and message-authentication construction will be used?
> suggest one
2. Is forward secrecy required in v1, or explicitly deferred?
> no
3. What key backup and recovery experience is acceptable?
> none needed
4. How will key revocation/replacement work after device loss?
> n/a
5. What is the existing conversation storage format?
> infer from code
6. What attachment size and retention limits are appropriate?
> no retentions. no attachements (images handling does not change)
7. Which Drive for Desktop versions and folder-availability modes will be supported?
> explain this
8. What exactly does “delivered” mean in the UI?
> similar to WhatsApp (sent - one grey checkmark, delivered - two grey checkmarks, read - green checkmarks)
9. How long should acknowledged transport files remain in the shared folder?
> recepient deletes those after processing.

## Appendix: Implementation cautions

- Google Drive for Desktop is a general file-sync client, not a messaging transport protocol. Its timing and
  local-folder behavior are not guaranteed to match chat requirements.
- Test shared-folder behavior on real Windows installations before committing to this design.
- Never infer cloud upload completion from local file existence.
- Never rely exclusively on filesystem watcher events.
- Never modify an event file after publishing it.
- Never treat folder membership as sender authentication.
- Never store private keys or plaintext in the shared folder.
- Never synchronize the live SQLite database.
- Never invent a cryptographic protocol; use a reviewed construction and obtain a security review before handling
  sensitive conversations.
