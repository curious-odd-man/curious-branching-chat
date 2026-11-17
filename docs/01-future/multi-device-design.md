# Design: the same person on several computers

**Status:** Draft 1, for review. The main decisions are answered (Section 2); the open questions are in Section 17  
**Date:** 2026-11-17  
**Context documents:** `requirements-next.md` section 2.9 (FR-281 to FR-284), `sync-protocol.md` (protocol version
1, releases 1.2 to 2.5), `google-drive-desktop-encrypted-chat-design.md` (D-01 to D-42), `adr-003-local-storage.md`  
**Release:** proposed as release 2.6

---

## 1. Context

Today one member of a synchronized discussion is one computer:

- One member has one participant ID and one key pair (Ed25519 for signatures, X25519 for encryption). The private keys
  are protected with Windows DPAPI and cannot leave the Windows account (`src/main/crypto/keyStore.ts`).
- The roster entry (`sync.json`, `sync-protocol.md` section 3.3) has one key pair per member.
- The shared folder has one inbox per member: `inbox/<participantId>/`. The inbox owner deletes each file after it
  processed it (section 9.4).
- `senderSeq` is counted per member (section 5). Two computers that use the same member would use the same numbers
  and refuse each other's events (section 9.1).

So the same person cannot simply install BranchChat on a second computer: two computers would read and delete files
from the same inbox, and each would get only part of the events. A person who uses a laptop and a desktop must today
be two members with two names.

### 1.1 Goal

FR-281 to FR-284 (`requirements-next.md` section 2.9): a person can use one identity on two or more computers;
messages written on one computer appear on the others with the same author; the read state belongs to the person; a
computer is added with a check on both computers and can be removed; the loss of one computer does not need a
re-invitation while another computer of the person still works.

### 1.2 Not a goal

- No sync of local (not shared) discussions, drafts, settings, or backups between the computers of a person. Each
  computer keeps its own library (ADR-003). A person who wants a local discussion on the other computer exports and
  imports it, as today.
- No server, no new network connection: everything still goes through the shared folder (ADR-002).
- No copy of private keys from one computer to another.

---

## 2. Decisions

Answers of 2026-11-17:

| No.  | Topic           | Decision                                                                                                                                                                                                           |
|------|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| MD-1 | Key model       | Each computer makes its own key pair. The person is one member with several **devices**. Private keys never leave a computer; a lost computer is removed alone                                                    |
| MD-2 | What is common  | The shared discussions and the person's own read state: a message read on the laptop is read on the desktop too. Drafts, settings, and local discussions stay per computer                                      |
| MD-3 | Old versions    | A second computer can be added to a discussion only after all members of that discussion run a version that supports devices. The app checks this and says which members must update                            |
| MD-4 | Approval        | A computer of the same person approves the new computer (a code shown on the existing computer and typed on the new one, then a fingerprint check). The other members accept the new device without a check |

Decisions of this design (to review):

| No.   | Topic                    | Decision                                                                                                                                                                                       |
|-------|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| MD-5  | Protocol version         | Protocol version 2. Envelopes get `senderDeviceId` and `recipientDeviceId`. A conversation changes to version 2 with its first added device; until then all apps write version 1              |
| MD-6  | Existing members         | The existing key pair of a member becomes the member's first device, with device ID = participant ID. So its inbox folder, its receipts, and its fingerprint do not change                   |
| MD-7  | Inbox                    | One inbox per device: `inbox/<deviceId>/`. Each event goes to every device of every member, also to the other devices of the sender                                                         |
| MD-8  | Version check            | Each device of version 2.6 or later writes a signed capability file `devices/<deviceId>.bcdev`. Older apps ignore the folder (section 3 of the protocol), so they see no new event and no "Обновите приложение" |
| MD-9  | Read and delivery state  | Stay per person (participant ID). A person has received a message when one of the person's devices has it                                                                                     |
| MD-10 | Removal                  | Any device of a person can remove any other device of the same person. A removed device gets no new copies; its later events are refused. Other members cannot remove a device of someone else |
| MD-11 | All devices lost         | As today: another member re-invites the person (D-15, D-32, `member.keys.replaced`); in version 2 this replaces all devices of the person with one new device                                |
| MD-12 | Other discussions        | A device is linked once per person. In the other shared discussions of the person, the existing device adds the new device by itself, when the new device has chosen the folder                 |

---

## 3. Terms

| Term          | Meaning                                                                                                              |
|---------------|----------------------------------------------------------------------------------------------------------------------|
| Person        | A member of a discussion, with one participant ID, one name, one read state. Messages have the person as author     |
| Device        | One BranchChat installation in one Windows account, with its own key pair and its own device ID                     |
| Device ID     | UUID. For the first device of an existing member: the participant ID (MD-6). For each added device: a new random ID |
| Legacy device | The first device of a member who joined with protocol version 1                                                      |
| Linking       | The steps that add a new device of a person (Section 9.2)                                                           |
| Pairing code  | A short code that the existing device shows and the new device needs, valid for 15 minutes                           |

---

## 4. Requirements (draft, replaces FR-281 to FR-284)

- **FR-281.** A person can use the same identity on two or more computers (at most 5 devices per person). Messages
  written on any of them appear on all others, with the same author and name. Own messages from another own computer
  are never unread and give no notification.
- **FR-282.** The read state belongs to the person: a message marked as read on one computer is read on the others
  after their next scan. Delivery marks (D-41) count the person, not the computer.
- **FR-283.** A computer is added from a computer of the same person: "Мои компьютеры > Подключить другой компьютер…"
  shows a pairing code; the new computer chooses the same shared folder and enters the code; both computers then show
  the fingerprint of the new computer, and the person confirms it on the existing computer.
- **FR-283a.** After linking, the new computer lists the other shared discussions of the person. When the person
  chooses the folder of one of them on the new computer, the existing computer adds the new device there without a
  new code.
- **FR-283b.** "Мои компьютеры" lists the devices of the person: name of the computer, fingerprint, when it was added,
  and when it was last seen (the last event that arrived from it).
- **FR-283c.** A device can be removed from any other device of the person ("Отключить"), or a device can disconnect
  itself ("Отключить этот компьютер"; it first writes all waiting copies). A removed device gets no new copies, and
  its events that arrive after the removal are refused.
- **FR-284.** The loss of one computer does not need a re-invitation while another computer of the person still works:
  the person removes the lost computer from another one. When all computers are lost, another member re-invites the
  person (FR-177); this replaces all devices of the person.
- **FR-285.** A device can be added to a discussion only when every device of every member has a version that supports
  devices. Otherwise the app names the members that must update, and adds nothing.
- **FR-286.** All members see the devices of each member in the roster dialog ("2 компьютера"). When a person adds a
  device, the other members see a one-time note in the status line ("Анна подключила компьютер «DESKTOP-7»"). The
  other devices of the person show a note that stays until it is closed, with "Отключить".
- **FR-287.** A new member of a discussion whose roster has version 2 must also have version 2.6 or later; an older
  key bundle is refused with the text "Участник должен обновить BranchChat".

---

## 5. Overview

```text
 Anna (person p-anna)                     shared folder                         Boris (person p-boris)
 ┌────────────────────┐                                                         ┌────────────────────┐
 │ laptop             │  writes to every device ──►  inbox/p-boris/   ──────►   │ desktop            │
 │ device = p-anna    │                              inbox/d-anna-2/  ◄── ─ ─   │ device = p-boris   │
 │ (legacy, MD-6)     │ ◄────── inbox/p-anna/  ◄──── writes to every device ─── │                    │
 └────────────────────┘                                                         └────────────────────┘
 ┌────────────────────┐
 │ desktop            │  inbox/d-anna-2/ (own inbox), also gets the events of the laptop
 │ device = d-anna-2  │  writes to inbox/p-anna/ and inbox/p-boris/
 └────────────────────┘
```

- An event is still one change of one person. It is written once for each **device** of each member, except the
  device that writes it. So Anna's laptop writes a message for Boris's desktop and for Anna's desktop.
- Each device has its own `senderSeq`, its own outbox, its own receipts, and its own local sync state.
- The discussion data (messages, branches, reactions, read state, delivery state) does not know devices. Only the
  roster and the envelopes know them.

---

## 6. Data model

### 6.1 Roster version 2 (`sync.json`)

```json
{
  "protocolVersion": 2,
  "members": [
    {
      "participantId": "p-anna",
      "displayName": "Анна",
      "addedBy": "p-boris",
      "addedAt": "…Z",
      "devices": [
        {
          "deviceId": "p-anna",
          "label": "LAPTOP-ANNA",
          "signingPublicKey": "…", "encryptionPublicKey": "…", "fingerprint": "…",
          "addedBy": "p-anna", "addedAt": "…Z",
          "previousKeys": [ ]
        },
        {
          "deviceId": "6b1c…",
          "label": "DESKTOP-7",
          "signingPublicKey": "…", "encryptionPublicKey": "…", "fingerprint": "…",
          "addedBy": "p-anna", "addedAt": "…Z"
        }
      ],
      "removedDevices": [
        { "deviceId": "…", "fingerprint": "…", "signingPublicKey": "…", "removedAt": "…Z", "removedBy": "…" }
      ]
    }
  ]
}
```

- `devices[].addedBy` is a device ID of the same person (or, for the legacy device, the member who invited the person;
  as in version 1).
- `label`: the Windows computer name, at most 64 characters, the same safe-name rules as attachment names. The person
  can rename a device later (`device.renamed`, open question Q-5).
- `removedDevices` keeps the signing key of each removed device, so its earlier events can still be verified (a late
  copy of an old message).
- Rules: device IDs are unique in the whole roster; at most 5 devices per person; a person has at least one device.

Migration from version 1 (in memory, when the roster is read, and in the file when the conversation changes to
version 2): the key fields of each member become `devices[0]` with `deviceId` = `participantId`, `addedBy` =
`addedAt` of the member, `label` = the member's name (the legacy device has no known computer name; with Q-5 the
device can send its computer name later with `device.renamed`).

`src/shared/validation/roster.ts`: `rosterMemberSchemaV2`, `syncInfoSchema` accepts both versions,
`devicesOf(member)` gives the devices of either version, `checkRosterIntegrity` checks the new rules.

### 6.2 Local identity

| Today (`settings.json`, key store)      | Version 2.6                                                                                                      |
|-----------------------------------------|------------------------------------------------------------------------------------------------------------------|
| `participantId`                         | unchanged: the person                                                                                            |
| key pair stored under `participantId`   | key pair stored under `deviceId`                                                                                 |
| —                                       | `deviceId`: equal to `participantId` on an existing installation (MD-6); a new UUID on a new installation        |
| —                                       | `ownDevices`: the devices of the person that this device knows (ID, label, fingerprint), for MD-12 and FR-283b  |

On a new computer, BranchChat makes a participant ID and a device ID as today. Linking (Section 9.2) replaces the
participant ID with the person's ID (open question Q-1 for a computer that already is a member of a shared
discussion).

### 6.3 Local sync state (`syncState.ts`)

Per conversation and device: `senderSeq`, outbox, receipts, held files, pending events, as today. Changes:

- `ownId` becomes two values: `ownParticipantId` and `ownDeviceId`.
- Replay keys become (`senderDeviceId`, `eventId`); the `seqs` map is per sender device.
- `peerLimits` (FR-268) are per device.
- New: `linkRequests` (Section 9.2, on the existing device), `deviceSeen` (last event time per device, FR-283b).

### 6.4 Discussion data

No change. Messages have `authorId` = participant ID. The read state and `delivery.json` stay keyed by participant ID
(MD-9). So the export format does not change for discussions without `sync.json`; a file with a version 2 roster is
refused by apps before 2.6 (they are not members of a version 2 conversation anyway, FR-285).

---

## 7. Shared folder layout (protocol version 2)

```text
<shared root>/
  branchchat-sync.json            marker; "protocolVersion": 2 after the change (Section 9.1)
  keys/<keyFileId>.bckey          public-key bundles (version 1, or version 2 with deviceId)
  devices/<deviceId>.bcdev        capability file of each device (new, Section 8.1)
  link/<requestId>.bclink         link request of a new device (new, Section 8.2)
  inbox/<deviceId>/               one folder per device; the legacy device keeps inbox/<participantId>/
    <eventId>.bcmsg, <partId>.bcpart, <receiptId>.bcrcpt, <invitationId>.bcinv
```

- `SHARED_FILE_NAME` gets the extensions `bcdev` and `bclink`. Older apps ignore these names and folders (section 3:
  names that do not match are ignored), so MD-8 needs no new event type.
- `<keyFileId>` of a version 2 bundle is computed from the device ID instead of the participant ID. For the legacy
  device both give the same name.

---

## 8. New files and events

### 8.1 Capability file `devices/<deviceId>.bcdev`

Plain JSON, signed like a key bundle (context `branchchat-device-v1`):

```json
{
  "format": "branchchat-device", "version": 1,
  "conversationId": "…", "participantId": "…", "deviceId": "…",
  "maxProtocolVersion": 2, "appVersion": "2.6.0",
  "updatedAt": "…Z", "signature": "…"
}
```

- Each device of 2.6 or later writes it at the start of sync when the content changes. It is not encrypted: it shows
  only what the folder already shows (the IDs are in the file names) and the app version. It has no computer name
  (Q-6).
- A reader accepts it only if the signature matches the key of that device in the roster.

### 8.2 Link request `link/<requestId>.bclink`

Written by the new device. Content: `crypto_secretbox` of the JSON below, with a key from the pairing code:

```text
key = crypto_pwhash(code, salt = first 16 bytes of SHA-256("branchchat-link-v1" || 0x00 || requestId),
                    OPSLIMIT_INTERACTIVE, MEMLIMIT_INTERACTIVE, ALG_ARGON2ID13)
```

```json
{ "format": "branchchat-link", "version": 1, "requestId": "…",
  "bundle": <key bundle version 2 of the new device>, "label": "DESKTOP-7", "createdAt": "…Z" }
```

- Pairing code: 10 characters from the Crockford base32 alphabet, shown as `7KQ4M-2XD9P` (50 bits). A code is valid
  for 15 minutes and for one request.
- The code protects against another person with access to the folder who writes a request in the person's name. It
  is not the only check: the person also compares the fingerprint on both screens (FR-283).

### 8.3 Envelope version 2

Version 1 fields, plus:

| Field               | Rule                                                                                           |
|---------------------|------------------------------------------------------------------------------------------------|
| `protocolVersion`   | 2                                                                                              |
| `senderDeviceId`    | The writing device. Must be an active device of `senderId` in the roster (or removed, see 9.6) |
| `recipientDeviceId` | The device whose inbox gets the file. Must be the reading device                               |
| `senderSeq`         | Strictly increasing per sender **device**                                                      |

The signature is checked with the key of `senderDeviceId`. A version 2 device still reads version 1 envelopes; for them
`senderDeviceId` = `senderId` (the legacy device).

### 8.4 New event types

| Type                | Payload                                                                         | Sent by                   | Rule                                                                                                                                                                               |
|---------------------|---------------------------------------------------------------------------------|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `device.added`      | `{ participantId, device: <roster device entry> }`                              | a device of that person   | Applied without a check (MD-4) when `senderId` = `participantId`, the device ID is new, and the person has fewer than 5 devices. The first one in a version 1 roster changes the roster to version 2 |
| `device.removed`    | `{ participantId, deviceId, removedAt }`                                         | a device of that person   | The device moves to `removedDevices`. Nobody writes copies to it any more. A device cannot remove the last device of its person                                                  |
| `device.invitation` | as `invitation` (section 7.10), plus `{ person: { participantId, displayName, conversations: [{ conversationId, title, folderName }] } }` | the approving device      | Sealed to the new device. The snapshot is the full discussion with the version 2 roster. `conversations` lists the other shared discussions of the person (FR-283a)          |
| `device.renamed`    | `{ deviceId, label }`                                                            | the device itself         | Only if Q-5 is answered yes                                                                                                                                                         |

`device.invitation` uses `invitation.part` for its snapshot parts.

### 8.5 Changed rules of existing events

| Event                    | Version 2 rule                                                                                                                                         |
|--------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| All                      | Written for each active device of each member except the writer. The other devices of the sender get a copy too                                       |
| `message.sent` and parts | An own message from another own device is applied as any other message: author = the person; no unread mark, no notification (FR-281)               |
| `readstate.added`        | Unchanged (per person). A device also sends it to the other devices of its person: this gives FR-282                                                 |
| `delivery.added`         | Per person. A device sends it only for messages that its person did not have yet in `delivery.json`                                                   |
| `receipt.delivered`      | Per device pair: the writer deletes its copy for device X when device X confirmed it                                                                   |
| `member.limits.set`      | Per device; the warning of FR-268 names the device: "Анна (LAPTOP-ANNA) не получит этот файл"                                                         |
| `profile.updated`        | From any device of the person. The other devices of the person also change the name in their local settings                                         |
| `member.added`           | The roster entry has `devices`. Written to every device of every earlier member                                                                        |
| `member.keys.replaced`   | Replaces **all** devices of the person with one device (MD-11). Removed devices go to `removedDevices`                                                 |
| `invitation`             | `minProtocolVersion` = 2 in a version 2 conversation (FR-287)                                                                                          |

---

## 9. Flows

### 9.1 Version check and change to protocol version 2

1. Each device of 2.6 or later writes its capability file (8.1) in each of its shared folders.
2. Before the first linking in a conversation, the approving device checks: every active device of every member has a
   valid capability file with `maxProtocolVersion` ≥ 2. If not: "Подключить компьютер можно, когда все участники
   обновят BranchChat. Ещё не обновили: Борис, Вера." (FR-285).
3. The first `device.added` changes the roster to version 2. Each device that applies it writes the marker with
   `protocolVersion: 2` (idempotent) and from then on writes only version 2 envelopes in that conversation.
4. Copies in version 1 that are still in the folder are read as before (legacy device).

### 9.2 Linking a new computer (first discussion)

```text
 existing device E (laptop)                    shared folder                    new device N (desktop)
 "Подключить другой компьютер…"
 1. check versions (9.1)
 2. show code 7KQ4M-2XD9P, folder name   ─ ─ the person reads it ─ ─►   3. "Присоединиться" > "Это мой компьютер"
                                                                         choose the same folder, type the code
                                          ◄── link/<id>.bclink  ──────   4. write request (8.2); show own fingerprint
 5. open the request with the code;
    show "Подключить «DESKTOP-7»?
    Отпечаток: 3F2A 91C0 …"
 6. the person compares with N's screen,
    clicks "Да, это мой компьютер"
 7. write device.added to all other devices ──►  inbox/*/
 8. write device.invitation + parts       ──►  inbox/<N>/            ──►   9. import: check snapshot and roster,
                                                                         set participant ID = person, device ID
 10. delete the request; on N's receipt:  ◄──  receipt  ◄──────────────    show "Компьютер подключён"
     "DESKTOP-7 подключён"
```

- E accepts one request per code. A request that does not open with the code is ignored (it can be for another code
  of another person); a request older than 15 minutes is deleted by E.
- N is a full member at once: it writes its own events with its own device ID. Copies that other members wrote before
  they applied `device.added` did not include N; N has the history from the snapshot.
- Messages of N in the first seconds can arrive at a device of another member before that device has applied
  `device.added`. They wait in the pending queue (signature of an unknown device), as events of a new member do today
  (section 9.6: no quarantine while a `device.added` for that person may still come; limit 10 minutes, then the normal
  rules).

### 9.3 The other discussions of the person (FR-283a, MD-12)

1. After the import, N shows "Другие общие обсуждения": the titles and folder names from `device.invitation`.
2. The person chooses the folder of a discussion on N (N can also search the parent folder of the first shared folder
   for markers with these conversation IDs and suggest the paths).
3. N writes its version 2 key bundle to `keys/` of that folder.
4. Any device of the person that is a member there and has N in `ownDevices` sees the bundle at its next scan, checks
   that the keys equal the known keys of N, checks versions (9.1), and runs steps 7 and 8 of 9.2 (no code, no
   question; a note "DESKTOP-7 подключён к «Планы»").
5. If no own device is running, N shows "Ждём другой ваш компьютер" until one is.

### 9.4 A device disconnects itself

"Мои компьютеры > Отключить этот компьютер": N writes all waiting copies (the outbox is empty or only waits for
receipts), writes `device.removed` for itself to all devices, then stops sync of all shared discussions. Its library
keeps the discussions as local copies, like "Отправить копию" (D-26). The person can link the computer again later
(a new device ID).

### 9.5 A lost computer (FR-284)

From any other device: "Мои компьютеры > LAPTOP-ANNA > Отключить": `device.removed` to all devices of all members.
Each device stops writing copies to the removed device, removes its own waiting copies for it, and refuses the
removed device's events from then on (9.6).

The removed device, if it comes back, reads `device.removed` and shows "Этот компьютер отключён на другом вашем
компьютере"; it stops sync like 9.4.

### 9.6 Events of a removed device

A device keeps the removed device's signing key in `removedDevices`. An event from it:

- that this device processed before it applied `device.removed`: already applied;
- that arrives later: refused and deleted, with a note in the log. A message written on the lost laptop just before the
  loss is lost too. This is the safe choice for a stolen computer (open question Q-3).

### 9.7 All computers lost

As today (D-15, D-32): another member re-invites the person; `member.keys.replaced` (version 2) replaces all devices
with the one new device. Each member checks the fingerprint, as today.

### 9.8 A new member in a discussion with several devices

The inviter's invitation has the version 2 roster. The new member writes its events to all devices of all members.
`member.added` goes to all devices of earlier members. The new member must have 2.6 or later (FR-287).

---

## 10. Code changes by area

| Area                                  | Change                                                                                                                                                                                                                                                                                            |
|---------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `shared/validation/roster.ts`         | Roster version 2, `devicesOf()`, migration from version 1, integrity rules                                                                                                                                                                                                                        |
| `shared/sync/schemas.ts`              | Envelope version 2, the new payloads, capability file, link request, key bundle version 2, `SHARED_FILE_NAME`                                                                                                                                                                                     |
| `shared/sync/apply.ts`                | `device.added`, `device.removed`, version 2 meaning of `member.keys.replaced`                                                                                                                                                                                                                     |
| `main/crypto/keyStore.ts`, `identity` | Keys stored by device ID; existing keys stay under the participant ID (= legacy device ID), so nothing moves                                                                                                                                                                                      |
| `main/crypto/envelope.ts`             | Version 2 fields; verification with the device key; `previousKeys` per device                                                                                                                                                                                                                     |
| `main/sync/conversationSync.ts`       | `ownParticipantId` / `ownDeviceId`; fan-out to devices; inbox per device; replay per device; capability file; link requests (approving side); auto-add in other discussions (9.3); events of the own other devices; removal; "last seen" per device. The largest change: about 23 places use `ownId` today |
| `main/sync/onboarding.ts`             | "Это мой компьютер" join flow (new device side), `device.invitation` import, the list of other discussions                                                                                                                                                                                         |
| `main/sync/syncService.ts`            | Person-level device list (`ownDevices`), the notes of FR-286                                                                                                                                                                                                                                       |
| `main/local-state/settings.ts`        | `deviceId`, `ownDevices`                                                                                                                                                                                                                                                                          |
| Renderer                              | Settings: "Мои компьютеры" (list, "Подключить другой компьютер…", "Отключить"); join wizard: "Это мой компьютер"; roster dialog: devices per member; status line notes                                                                                                                             |
| `shared/i18n/ru.ts`, `en.ts`          | All new texts (NFR-205)                                                                                                                                                                                                                                                                           |
| Docs                                  | `sync-protocol.md` version 2 (new sections), `requirements.md`, `security-review.md`, user guide (Russian), checklist section V                                                                                                                                                                  |

---

## 11. User interface (texts in Russian; English in `en.ts`)

- Settings, new section **"Мои компьютеры"**: a row per device: name of the computer, "этот компьютер" for the own
  one, fingerprint, "подключён 17.11.2026", "последний раз: 5 минут назад", button "Отключить". Buttons
  "Подключить другой компьютер…" and "Отключить этот компьютер".
- **"Подключить другой компьютер…"** dialog: choose the shared discussion (the first link), the version check result,
  then the code in large letters, the folder name, "Код действует 15 минут", and the text: "На другом компьютере
  откройте Файл > Присоединиться к обсуждению > «Это мой компьютер», выберите эту же общую папку и введите код."
- Join wizard: a first choice "Меня пригласил другой участник" / "Это мой компьютер, BranchChat уже есть на другом
  моём компьютере". The second asks for the folder and the code, then shows the own fingerprint: "Сравните отпечаток
  с тем, что показывает ваш другой компьютер."
- On the approving device: "Подключить компьютер «DESKTOP-7»? Отпечаток: …. Подключайте, только если отпечаток
  совпадает с тем, что показывает новый компьютер." Buttons "Да, это мой компьютер" / "Отклонить".
- Roster dialog: "Анна — 2 компьютера" with the device names and fingerprints.
- Status line (other members, once): "Анна подключила компьютер «DESKTOP-7»."
- Note on the person's other devices (stays until closed): "К вашей учётной записи подключён компьютер «DESKTOP-7».
  Если это были не вы, отключите его." with "Отключить".

---

## 12. Security

| Threat                                                                   | Control                                                                                                                                                                                                      |
|--------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A person with folder access adds a device in someone's name              | The link request must open with the pairing code that only the person's screen shows, and the person confirms the fingerprint on the existing device. `device.added` is accepted only from a device of the same person |
| A stolen computer of the person                                          | Removal from another device (9.5); later events refused (9.6). A stolen computer can read what it already has: as today                                                                                     |
| A compromised device adds more devices                                   | Possible: a device of the person is trusted as the person (MD-4). All members get a note (FR-286); the person's other devices show a note with "Отключить"; at most 5 devices                            |
| Two devices remove each other (an attacker and the person)               | Both are removed; the person has no device left and is re-invited by another member (9.7) with a fingerprint check. The attacker keeps no access                                                          |
| Brute force of the pairing code                                          | 50 bits, Argon2id, 15 minutes, one request per code, and the fingerprint check by the person                                                                                                                 |
| Capability file changed by someone in the folder                         | Signed with the device key; an invalid file counts as "not updated" (the safe result: no linking)                                                                                                            |
| More metadata in the folder                                              | New inbox folders and capability files show how many devices a person has. Computer names stay inside encrypted files (Q-6)                                                                                |
| Private keys                                                             | Never leave a computer (MD-1); DPAPI as today                                                                                                                                                                |

---

## 13. Compatibility and migration

- A conversation stays at protocol version 1 until its first `device.added`. Apps 2.6+ write version 1 envelopes
  there, so members with older apps notice nothing.
- After the change, older apps are not possible in that conversation: FR-285 checks this before the change, and
  FR-287 for new members. If an older app still appears (a member installs an old version again), it sees version 2
  envelopes as unknown and shows "Обновите приложение" (section 10 of the protocol).
- Existing installations keep their keys and inbox (MD-6); there is no migration of files in the shared folder.
- The library (ADR-003) changes only in the stored roster (`discussion.sync` JSON): roster version 2 after the change.
- Export: a discussion exported without the roster (as today) can be imported by any version 2.4+.

---

## 14. Performance

- Each event is written once per device instead of once per member. With 5 members and 2 devices each, a message is
  written 9 times instead of 4. Files are small; images and attachments are written per device too (open question
  Q-4: parts once per person with one key for all devices of the person would save space, but needs a shared secret
  per person).
- Each device scans only its own inbox. Scan time does not change.

---

## 15. Tests

- Unit: roster version 2 schema and migration; `devicesOf`; apply rules of `device.added` (only from the same person,
  limit 5, duplicate), `device.removed` (not the last device), `member.keys.replaced` in version 2; envelope version 2
  sign and verify; replay per device; capability file signature; link request with the right and the wrong code;
  pairing code expiry.
- Sync engine (as `tests/sync/release24.test.ts`, with three persons and two devices for one): fan-out to all
  devices; own message from the other own device (no unread, no notification); read on one device → read on the other
  (FR-282); delivery marks per person; removal and refused later events; two devices remove each other; a member with
  an old capability blocks linking (FR-285); a version 1 conversation keeps version 1 envelopes; late events of a new
  device wait for `device.added`.
- e2e (two app instances with the same person, one shared folder): link with the code; message from both computers;
  read state on both; "Мои компьютеры" list; remove; the second discussion added without a code (9.3).
- Windows checklist section V: two real computers with Google Drive; a computer that is off during linking of a
  second discussion; a lost computer.

---

## 16. Implementation phases (release 2.6)

| Phase | Content                                                                                                                                         | Done when                                                                                    |
|-------|-------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| 17    | Protocol version 2 data: roster version 2, envelope version 2, new schemas, `devicesOf`, `ownParticipantId`/`ownDeviceId` in the engine, fan-out to devices (with one device per person all tests stay the same) | All existing tests pass; new unit tests of Section 15 (data part)                           |
| 18    | Capability files and the version check (FR-285); `device.added`, `device.removed`, events of own other devices, read state across own devices | Sync engine tests of Section 15                                                              |
| 19    | Linking: pairing code, link request, `device.invitation`, join wizard "Это мой компьютер", "Мои компьютеры", notes of FR-286                   | e2e tests; security review section; texts in `ru.ts` and `en.ts`                            |
| 20    | Other discussions without a code (9.3), self-disconnect, removal of a lost device, documents (protocol version 2, requirements, user guide), checklist V | All tests; Windows check with two computers                                                  |

---

## 17. Open questions

**Q-1. A new computer that already is a member of a shared discussion with its own identity.** Linking changes its
participant ID to the person's. Its old memberships would break. Recommendation: linking is refused on a computer that
is a member of a shared discussion ("Сначала отключите этот компьютер от общих обсуждений"); local discussions are
kept (their messages keep the old author ID and the old name).

**Q-2. Maximum number of devices per person.** Recommendation: 5.

**Q-3. Events of a removed device that arrive late.** Refuse (safe, a stolen laptop cannot add messages; a message
written just before the loss is lost) or accept events with `createdAt` before `removedAt` (no loss, but the time comes
from the removed device). Recommendation: refuse.

**Q-4. Images and attachments per device.** Write the parts once per device (simple, more space in the shared folder)
or once per person with a per-person key (less space, more complex). Recommendation: once per device in release 2.6.

**Q-5. Rename a device** (`device.renamed`). Recommendation: yes, from the device itself; the default is the Windows
computer name.

**Q-6. Computer names in the shared folder.** The capability file has the label in plain text (the storage service can
read it). Alternative: the label only inside encrypted events. Recommendation: no label in the capability file; the
label travels in `device.added` and in the encrypted link request.

**Q-7. Can another member remove a device of a person** (for example, when the person left the company and only has a
stolen laptop)? Recommendation: no; the existing re-invitation (9.7) covers it.
