# BranchChat Sync Protocol, version 1

**Status:** Contract for releases 1.2 to 1.5. Release 1.1 contains the schemas only.  
**Source:** `docs/01-future/google-drive-desktop-encrypted-chat-design.md` (revision 6), decisions D-01 to D-38.  
**Code:** `src/shared/sync/` (schemas, canonical serialization, framing). Cryptography: `src/main/crypto/`.

This document is the contract between members that use different releases. A change to a rule in this document needs
a new protocol version (Section 10).

---

## 1. Terms

| Term           | Meaning                                                                                        |
|----------------|------------------------------------------------------------------------------------------------|
| Conversation   | One synchronized discussion. Conversation ID = `manifest.documentId` of the `.branchchat` file |
| Member         | A participant in the roster (`sync.json`, Section 3.3) with accepted public keys               |
| Shared root    | The local path of the shared folder that a sync product keeps in sync                          |
| Event          | One signed change. One event is written as one file per recipient                              |
| Part           | A piece of a large message or invitation, written as a separate file                           |
| Recipient copy | The encrypted file of one event or part for one recipient                                      |
| Clock          | Lamport clock: a whole number ≥ 0                                                              |

---

## 2. Encodings

### 2.1 Basic values

- Text: UTF-8.
- IDs: lowercase UUID version 4 strings (`crypto.randomUUID()`), unless stated otherwise.
- Times: ISO-8601 UTC with `Z`, as in the document format (display only, never used for order).
- Binary values inside JSON (keys, signatures, hashes): standard base64 with padding (RFC 4648 section 4).
- SHA-256 values inside JSON: lowercase hex, 64 characters.
- Numbers: whole numbers only, from 0 to 2^53 − 1. Floating-point numbers are not allowed in protocol JSON.

### 2.2 Canonical JSON

All signed JSON uses this serialization (`canonicalJson()` in `src/shared/sync/canonical.ts`):

1. Objects: keys sorted by UTF-16 code unit order (the default JavaScript string order). No duplicate keys.
2. No white space between tokens.
3. Strings: as `JSON.stringify` writes them.
4. Numbers: whole numbers in decimal, no sign for 0, no exponent.
5. Arrays keep their order.
6. `undefined` values and keys with `undefined` values are not allowed. Leave the key out instead.
7. `null`, `true`, `false` as in JSON.

The serializer refuses any value that breaks these rules. Test vectors: `tests/sync/canonical.test.ts`.

---

## 3. Shared root layout

```text
<shared root>/
  branchchat-sync.json            conversation marker (plain JSON, Section 3.1)
  keys/<participantId>.bckey      public-key bundles (Section 4)
  inbox/<participantId>/          one folder per member
    <eventId>.bcmsg               event (all types except invitation and receipts)
    <partId>.bcpart               part of a message or an invitation
    <receiptId>.bcrcpt            delivery receipt
    <invitationId>.bcinv          invitation header
  .test/<random>.tmp              folder test
```

- `<participantId>`, `<eventId>`, `<partId>`, `<receiptId>`, `<invitationId>`: IDs as in Section 2.1. A name that
  does not match `^[0-9a-f-]{36}\.(bcmsg|bcpart|bcrcpt|bcinv|bckey)$` is ignored. Sync-product conflict copies (for
  example `<id> (1).bcmsg`) are also read, because the event ID comes from the authenticated content, not from the
  name.
- Files are written under a temporary name `<name>.<random>.tmp` in the same folder, then renamed. Readers ignore
  `.tmp` files.
- No file in the shared root contains plain text of the discussion, private keys, or local state.

### 3.1 Conversation marker

`branchchat-sync.json`:

```json
{ "format": "branchchat-sync", "protocolVersion": 1, "conversationId": "<documentId>" }
```

No names and no content. One shared root holds one conversation.

### 3.2 Recipient copy file format

Each `.bcmsg`, `.bcpart`, `.bcrcpt`, and `.bcinv` file contains only the output of libsodium `crypto_box_seal` for
the recipient's X25519 public key. There is no plain header.

The plaintext inside the sealed box (the **frame**):

| Bytes | Content                                                     |
|-------|-------------------------------------------------------------|
| 4     | Magic `BCE1` (ASCII)                                        |
| 4     | Length `L` of the envelope JSON, unsigned 32-bit big-endian |
| `L`   | Envelope JSON (canonical, Section 5)                        |
| 64    | Ed25519 detached signature (Section 6)                      |
| rest  | Binary payload (only for parts; empty for all other events) |

### 3.3 Roster in the `.branchchat` file

A synchronized discussion has a ZIP entry `sync.json` (document schema version 2):

```json
{
  "protocolVersion": 1,
  "members": [
    {
      "participantId": "…",
      "displayName": "…",
      "signingPublicKey": "<base64, 32 bytes>",
      "encryptionPublicKey": "<base64, 32 bytes>",
      "fingerprint": "…",
      "addedBy": "<participantId>",
      "addedAt": "…Z",
      "previousKeys": [
        { "signingPublicKey": "…", "encryptionPublicKey": "…", "fingerprint": "…", "replacedAt": "…Z" }
      ]
    }
  ]
}
```

- The initiator has `addedBy` = own `participantId`.
- A file without `sync.json` is not synchronized. "Отправить копию…" removes the entry (D-26).

---

## 4. Public-key bundle

File `keys/<participantId>.bckey` or a file the person saves, with this JSON:

```json
{
  "format": "branchchat-key",
  "version": 1,
  "participantId": "…",
  "displayName": "…",
  "signingPublicKey": "<base64>",
  "encryptionPublicKey": "<base64>",
  "fingerprint": "…",
  "createdAt": "…Z",
  "signature": "<base64>"
}
```

- `signature`: Ed25519 signature with the bundle's own signing key over the canonical JSON of the bundle **without**
  the `signature` key, prefixed with the context `branchchat-key-v1` and one zero byte. It proves that the bundle's
  owner has the private signing key. It does not prove the person's identity: the fingerprint check does that.
- Text form (for copy and paste): `BRANCHCHAT-KEY-1:` followed by the base64url (no padding) of the UTF-8 canonical
  JSON of the full bundle.
- The receiver recomputes the fingerprint and refuses a bundle whose `fingerprint` field differs.

### 4.1 Fingerprint

```text
fingerprint = upper-hex( SHA-256( "branchchat-fingerprint-v1" || 0x00 || signingPublicKey || encryptionPublicKey ) )[0..32]
```

The first 32 hex characters (128 bits), shown in 8 groups of 4: `3F2A 91C0 7B4E 0D18 A5C3 6E90 12FB 47D2`.

---

## 5. Envelope

```json
{
  "protocolVersion": 1,
  "eventId": "…",
  "type": "message.sent",
  "conversationId": "…",
  "senderId": "…",
  "recipientId": "…",
  "senderSeq": 17,
  "clock": 245,
  "createdAt": "…Z",
  "payload": { },
  "payloadSha256": "…"
}
```

| Field             | Rule                                                                                       |
|-------------------|--------------------------------------------------------------------------------------------|
| `protocolVersion` | 1 for this document                                                                        |
| `eventId`         | Random. The same for all recipient copies of one event, and for a retry                    |
| `type`            | One of Section 7                                                                           |
| `senderSeq`       | Per sender and conversation: 1, 2, 3, … with no gaps, over all event types except receipts |
| `clock`           | Sender's Lamport clock after the change (Section 8)                                        |
| `payload`         | Type-specific object (Section 7)                                                           |
| `payloadSha256`   | Only for parts: SHA-256 of the binary payload of the frame                                 |

Receipts (`receipt.delivered`) have `senderSeq` = 0 and do not change the sender's sequence.

---

## 6. Signature and encryption

1. Build the envelope for one recipient. Serialize it with canonical JSON (Section 2.2).
2. Sign `"branchchat-event-v1" || 0x00 || envelopeJson` with the sender's Ed25519 private key
   (`crypto_sign_detached`). Each recipient copy has its own signature, because `recipientId` differs.
3. Build the frame (Section 3.2) and encrypt it with `crypto_box_seal` to the recipient's X25519 public key.

The recipient:

1. Opens the sealed box with its own key pair. Failure → quarantine.
2. Checks magic, length, and that the envelope is valid canonical JSON that matches the schema.
3. Finds the sender in the roster. Verifies the signature with the sender's current signing key, or with a key in
   `previousKeys` if the event was created before the replacement (Section 9.2).
4. Checks `conversationId`, `recipientId` = own ID, and for parts `payloadSha256`.
5. Successful decryption alone is never proof of the sender.

---

## 7. Event types

All payload objects refuse unknown keys (`strict`). A new key needs a new protocol version.

### 7.1 `message.sent`

```json
{
  "message": {
    "messageId": "…", "threadId": "…", "authorDisplayName": "…", "createdAt": "…Z",
    "content": { "type": "doc", "content": [] },
    "assetReferences": ["<sha256>"]
  },
  "images": [ { "assetId": "<sha256>", "mediaType": "image/png", "size": 1234 } ],
  "parts": [ { "partId": "…", "kind": "image", "assetId": "<sha256>", "index": 0, "size": 4194304, "sha256": "…" } ]
}
```

- The author is the envelope `senderId`. The message clock is the envelope `clock`.
- `content` is present when the canonical JSON of `content` is at most 3 MiB. Otherwise `content` is left out, and
  `parts` has entries with `kind` = `content` (index 0, 1, …). Their payloads joined in index order are the UTF-8
  canonical JSON of the content.
- Every image in `assetReferences` that is not yet in the conversation is listed in `images` and has `parts` with
  `kind` = `image` and its `assetId`. Joined payloads give the image bytes; their SHA-256 must equal `assetId`.
- An image that the sender has already seen in the conversation is not sent again (no parts).
- The message is processed when all parts are present and checked (D-30).

### 7.2 `message.part`

Payload: `{ "messageId": "…", "partId": "…" }`. Binary payload: at most 4 MiB (4 194 304 bytes). The `partId`,
`size`, and `sha256` must match an entry in the signed `message.sent` of that `messageId`. A part can arrive before
its header; it waits in the local store.

### 7.3 `branch.created`

```json
{ "thread": { "threadId": "…", "parentThreadId": "…", "sourceMessageId": "…", "quoteText": "…",
              "selectionStart": 3, "selectionEnd": 9, "title": "…", "createdAt": "…Z" } }
```

`createdBy` = `senderId`, thread clock = envelope `clock`, status = `open`. `selectionStart`, `selectionEnd`, and
`title` are optional.

### 7.4 `branch.status.set` and `branch.title.set`

`{ "threadId": "…", "status": "open" | "closed" }` and `{ "threadId": "…", "title": "…" }` (empty string removes
the title). Last writer wins by (`clock`, `senderId`) (D-24).

### 7.5 `readstate.added`

`{ "messageIds": ["…"] }`. At most 10 000 IDs per event. Union with the sender's read state.

### 7.6 `member.added`

`{ "member": <roster entry without previousKeys> }`. Applied without confirmation (D-13).

### 7.7 `member.keys.replaced`

`{ "participantId": "…", "signingPublicKey": "…", "encryptionPublicKey": "…", "fingerprint": "…" }`. Each receiving
member must accept it after a fingerprint check (D-15, D-32). Releases 1.2 to 1.4 keep it pending.

### 7.8 `profile.updated`

`{ "displayName": "…" }`. Updates `participants[]` and the roster entry. Old messages keep their name.

### 7.9 `receipt.delivered`

`{ "ids": ["…"] }`: event IDs and part IDs that the receipt's sender has processed. At most 1 000 IDs. File type
`.bcrcpt`, written into the inbox of the original sender. `eventId` of a receipt is a new random ID.

### 7.10 `invitation` and `invitation.part`

Invitation header (`.bcinv`):

```json
{
  "invitationId": "…", "minProtocolVersion": 1, "replacesKeysOf": "<participantId, optional>",
  "snapshotSize": 123, "snapshotSha256": "…",
  "parts": [ { "partId": "…", "index": 0, "size": 4194304, "sha256": "…" } ]
}
```

- The snapshot is a complete `.branchchat` file (schema version 2, with `sync.json` and all images). Its bytes are
  split into `invitation.part` events (payload `{ "invitationId": "…", "partId": "…" }`), each at most 4 MiB.
- `replacesKeysOf` is present for a re-invitation after key loss (D-15).
- The invitee checks the inviter's fingerprint before it imports the snapshot.

---

## 8. Clocks and order

- Each member keeps a conversation clock `c`. Before a local change: `c = c + 1`; the change gets clock `c`. On
  receipt of an event with clock `e`: `c = max(c, e)`.
- Messages of a thread are sorted by (`clock`, `authorId`, `messageId`), string order for IDs. `sequence` is the
  index after the sort.
- Threads are sorted by (`clock`, `createdBy`, `threadId`). The main thread has clock 0.
- Branch status and title: last writer wins by (`clock`, participant ID).

---

## 9. Processing rules

### 9.1 Replay and duplicates

- An event is identified by (`senderId`, `eventId`). A known event is not applied again, but its receipt is sent
  again.
- `senderSeq` must be new for that sender. A gap is allowed (events can arrive out of order); a repeated `senderSeq`
  with a different `eventId` is refused.

### 9.2 Keys

- A member's events are verified with the current key. After `member.keys.replaced` is accepted, events with
  `createdAt` before `replacedAt` can also be verified with the previous key.
- Nobody encrypts to a key that the member has not accepted.

### 9.3 Dependencies

An event whose target (thread, source message, message of a part, member) is unknown or still loading waits in the
pending queue. No receipt is sent for it until it is applied.

### 9.4 Cleanup

- The owner of an inbox deletes each processed file in it. If the delete fails, it records the file as processed.
- The sender deletes its own event and part files after the receipt for them.
- The writer of a receipt deletes it after 7 days if it is still there.
- Own files without a receipt are deleted after 30 days.

### 9.5 Limits

- A file larger than the local setting (5 MB to 1 000 MB, default 30 MB) is not read.
- Envelope JSON: at most 4 MiB. Part payload: at most 4 MiB.

---

## 10. Versions

- `protocolVersion` in envelopes, the marker, the roster, and the invitation is 1.
- An event with a higher `protocolVersion` or an unknown `type` waits in the pending queue. The app shows
  "Обновите приложение". No receipt is sent for it.
- The join wizard refuses an invitation whose `minProtocolVersion` is higher than the app supports.
- All event types of Section 7 are defined in version 1, also the types that later releases send first.
