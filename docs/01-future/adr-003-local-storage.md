# ADR-003: Local storage of discussions

**Status:** Accepted (option C, variant C1; two detail questions open in Section 9)  
**Date:** 2026-11-14 (accepted 2026-11-14)  
**Context documents:** `requirements.md` (revision 13), `requirements-next.md` (draft 1), `performance.md`,
`adr-002-sync.md`, `sync-protocol.md`  
**Relation to ADR-001 and ADR-002:** Changes how a discussion is stored on the computer. The technology (Electron +
TypeScript) and the sync protocol do not change.

---

## 1. Context

Today one discussion is one `.branchchat` file: a ZIP with `manifest.json`, `discussion.json`, `readstate.json`,
`sync.json`, `delivery.json`, and the images under `assets/`. The file is the working store and also the exchange
format.

How a save works now (`src/main/document/documentFile.ts`, `documentSession.ts`):

- Every change (a message, a read mark, a branch status) writes a **complete new file**: all JSON entries are
  serialized and compressed again, and every image is copied from the old file into a temporary file, which then
  replaces the old file. Saves are queued; several quick changes give one write.
- The whole discussion is in memory while it is open.

Measured (`performance.md`, Linux container):

| Discussion                   | Send a message: saved in file                       |
|------------------------------|-----------------------------------------------------|
| 5,000 messages, 63 KB file   | 0.18 s                                              |
| 20,000 messages, 251 KB file | 0.49 s                                              |
| Hundreds of MB of images     | not measured; the whole file is rewritten each time |

The cost grows with the size of the discussion, and it is worst for discussions with many images: one new message
rewrites all images. A discussion file in a cloud folder (Google Drive, OneDrive) is uploaded completely again after
each change.

Release 2 adds features that need fast queries and partial reads: search (Ctrl+F), several discussions in one window,
reactions, file attachments, drafts, and a branch map (`requirements-next.md`).

The person still wants to export and import a `.branchchat` file to share a discussion.

Note: storage is not the only cost. Each change also sends the complete discussion view to the window
(`performance.md`, "Known cost"). That is separate work and every option below needs it for very large discussions.

## 2. Decision drivers

1. **Write cost** must not grow with the size of the discussion (messages and images).
2. **No data loss** after a crash or a power cut in the middle of a write.
3. **Search** across all branches, and later across all discussions, with case folding and ё = е.
4. **Sharing by file** stays possible: export and import of `.branchchat`, also with people on older versions.
5. **Security:** a file from another person is untrusted input and is validated before use (FR-125).
6. **No native modules** if possible: they must be rebuilt for each Electron version and complicate the installer.
7. **Migration** of existing `.branchchat` files, also synchronized ones, without data loss.
8. **Backup:** the person must not lose discussions when Windows is reinstalled.

## 3. Options

### Option A: keep the ZIP file, and write it in parts

The file stays the working store. New images are appended to the end of the ZIP; only the JSON entries and the
central directory are written again. A periodic compaction removes old entries.

### Option B: the `.branchchat` file becomes a SQLite database

The file itself is a SQLite database ("SQLite as an application file format"). Each change is a small transaction.
Images are rows with BLOBs.

### Option C: a local SQLite library; `.branchchat` only for export and import

All discussions are in one SQLite database in `%APPDATA%\BranchChat` (the "library"). The window shows discussions
from the library. A `.branchchat` ZIP is made on export and read on import. The ZIP format stays as it is now.

Two variants decide what a `.branchchat` file on disk means:

- **C1, library:** opening a `.branchchat` file imports it into the library (a copy). After that, the file is not
  changed by the app. To share, the person exports again.
- **C2, library with a mirror:** the library is the working store, but the app also keeps the original `.branchchat`
  file up to date in the background (for example 30 seconds after the last change, and when the window closes).
  The person still has "the file" in Documents, but it is written seldom, not on each change.

### Option D: a folder per discussion

The discussion is a folder with one JSON file per branch and an `assets` folder. Writes are small.

### Option E: an append-only event log per discussion

The discussion is a log of events (as in the sync protocol) plus a snapshot from time to time. Each change appends one
record.

## 4. Comparison

| Driver              | A: ZIP in parts                                                 | B: SQLite file                                                                                          | C: SQLite library + ZIP export                                                        | D: folder           | E: event log          |
|---------------------|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|---------------------|-----------------------|
| 1. Write cost       | Medium: JSON still complete                                     | Low                                                                                                     | Low                                                                                   | Low                 | Low                   |
| 2. Crash safety     | Weak: in-place append has no atomic replace; needs own recovery | Strong (transactions)                                                                                   | Strong (transactions)                                                                 | Weak across files   | Medium: own checksums |
| 3. Search           | In memory only                                                  | FTS5                                                                                                    | FTS5, also across all discussions                                                     | In memory only      | In memory only        |
| 4. Sharing by file  | Unchanged                                                       | The file changes format; older versions cannot open it; a copy taken while the app writes can be broken | Unchanged ZIP format; export is explicit (C1) or automatic (C2)                       | Needs a ZIP to send | New format            |
| 5. Untrusted input  | Unchanged (zod)                                                 | Hard: a crafted database can hold triggers and views; needs a defensive mode and a schema check         | Unchanged: import reads the ZIP with zod                                              | Unchanged           | New parser            |
| 6. No native module | Yes                                                             | Yes (`node:sqlite`)                                                                                     | Yes (`node:sqlite`)                                                                   | Yes                 | Yes                   |
| 7. Migration        | None                                                            | Each file is converted                                                                                  | Each file is imported once                                                            | Each file converted | Each file converted   |
| 8. Backup           | The file is in Documents                                        | The file is in Documents                                                                                | **The data is in AppData**: needs a backup feature (C1); C2 keeps a copy in Documents | In Documents        | In Documents          |
| Effort              | M                                                               | L                                                                                                       | L (C1) to XL (C2)                                                                     | M                   | L                     |

Notes:

- `node:sqlite` is part of the Node that Electron 45 contains (Node 24.22, SQLite 3.53, with FTS5). It was checked in
  this project's Electron. Its API is marked "release candidate" in Node 24, so a later Electron can change details.
  Fallback: `better-sqlite3` (a native module).
- Checked: the FTS5 tokenizer `unicode61` folds case for Cyrillic ("ЁЖИКА" is found by "ёжика"), but it keeps ё and е
  apart, also with `remove_diacritics 2`, and it has no Russian stemming ("ёжик" finds "ёжика" only as the prefix
  search "ёжик*"). The app must store a normalized copy of the text (ё → е) for search.
- Speed in this Electron (Linux container): 20,000 inserts in one transaction 0.36 s; one insert less than 1 ms.
- Option B with WAL mode writes `-wal` and `-shm` files next to the user's file. With the rollback journal it stays one
  file at rest, but it is still not safe to copy or e-mail while the app writes.

## 5. Decision

**Option C, variant C1: a local SQLite library with `node:sqlite`; `.branchchat` ZIP only for export and import.**

| Topic                        | Decision                                                                                                                 |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| A `.branchchat` file on disk | Opening it imports a copy into the library. The app never changes the file again. Sharing is an explicit export (Q-01)   |
| Backups                      | Automatic daily backup in `%APPDATA%\BranchChat\backups` (last 7), and also into a folder that the person chooses (Q-02) |
| Import of a known discussion | Merge by ID: new messages, branches, and read marks from the file are added; nothing is removed (Q-03)                   |
| Journal mode                 | WAL (Q-04)                                                                                                               |
| Images and attachments       | Files in `%APPDATA%\BranchChat\blobs\<sha256>`, not BLOBs; the database keeps the hash, type, and size (Q-05)            |
| Migration                    | At the first start, one question with the list of known files, all selected (Q-06)                                       |

Reasons:

- It removes the write cost (driver 1) and gives transactions (driver 2) and full-text search across all discussions
  (driver 3).
- The exchange format does not change: older versions and other people keep using `.branchchat` files, and import
  keeps the strict validation of today (drivers 4 and 5).
- It fits the planned features: several discussions in one window, a search across discussions, drafts, and file
  attachments are rows in one database.
- Synchronized discussions already exchange events, not files (ADR-002). The sync engine changes its document port
  from "file" to "library"; the protocol stays the same.

Option B was not chosen because untrusted database files are a large attack surface and a database is a poor file to
copy while it is open. Option A keeps most of today's cost and needs its own crash recovery.

## 6. Consequences

### What changes for the person

- Discussions live in the app. The window gets a discussion list (requirement item 3 needs this anyway).
- "Новое обсуждение" makes a discussion in the library; no save dialog.
- Double-click on a `.branchchat` file: import into the library (merge if the discussion is already there), then the
  discussion opens.
- New commands: "Экспортировать…" (a `.branchchat` file to send), "Импортировать…", "Резервная копия сейчас",
  "Восстановить из резервной копии…", and a backup folder in Settings.
- "Отправить копию…" becomes "Экспортировать…".

### What changes in the code

| Area                             | Change                                                                                                                                                                     |
|----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/main/document/`             | Stays for import and export (ZIP read and write, migrations, validation)                                                                                                   |
| New `src/main/library/`          | Database schema, migrations, queries, search index, blob storage for images and attachments                                                                                |
| `documentSession.ts`             | Reads and writes through the library; small transactions instead of whole-file writes                                                                                      |
| Sync (`syncService`, registry)   | The registry links a discussion ID to a shared folder, not a file path; moved-file handling (FR-168) and the detached copy (FR-154) are not needed for library discussions |
| Recent files, file association   | Recent files become the discussion list; the file association imports                                                                                                      |
| FR-117 (copy changed elsewhere)  | Replaced by the merge on import (Q-03)                                                                                                                                     |
| New `src/main/library/blobs.ts`  | Content-addressed files for images and attachments: write to a temporary file, check the hash, rename; delete unused files later (Q-07)                                    |
| New `src/main/library/backup.ts` | Daily backup with the SQLite backup API plus the blob files that are new since the last backup                                                                             |
| Tests                            | Library unit tests; e2e tests move from "file on disk" to "library" plus export and import                                                                                 |

### Database outline (to be refined in the design)

- `discussion` (id, title, created, schema version, synced flag), `participant`, `thread`, `message` (with clocks and
  the rich text as JSON), `read_state`, `delivery`, `roster_member`, `blob` (sha256, mime, size; the bytes are a file),
  `draft`, `reaction`, `attachment`, `search_index` (FTS5 over normalized text: lower case, ё → е).
- One database file in WAL mode, `PRAGMA foreign_keys = ON`, `trusted_schema = OFF`.
- Blob files: `blobs\<first 2 hex>\<sha256>`. A file is written to a temporary name, its hash is checked, then it is
  renamed. The database row is written after the file exists, so a crash leaves at most an unused file, never a row
  without a file.
- A schema version table and forward-only migrations, as for the file today.

### Merge on import (Q-03)

- Messages, branches, and participants are matched by ID; new ones are added. A message that exists keeps its content
  (messages are not edited).
- Read marks and delivery marks: union (as `readstate.added`).
- Branch title and state: the change with the later stamp wins (`titleSet`, `statusSet`, schema version 2), as in the
  sync protocol. A file of schema version 1 has no stamps; then the library keeps its value.
- Images and attachments: added by hash.
- The merge is one transaction. The result passes the same integrity check as an imported file.

### Backups (Q-02)

- Once a day (at the first start of the day, or at the next full hour while the app runs), and before each migration
  of the library schema.
- A backup is the database (SQLite backup API, consistent while the app writes) plus the blob files. Blob files never
  change, so a backup copies only the new ones.
- `%APPDATA%\BranchChat\backups`: the last 7. The folder of the person: the same backup, also the last 7.
- A backup contains private messages. It is stored as it is (no encryption) in both places; Settings say so. The
  private keys are not in the backup (they are protected by Windows and useless on another computer).

### Migration of existing files

- At the first start of the new version, the app shows one question with the files from the recent list and the sync
  registry, all selected. Each file is validated as today, then imported. The original file is not deleted.
- A synchronized discussion keeps its conversation ID, roster, keys, and sync state; only the document port changes.

## 7. Risks

| Risk                                                           | Mitigation                                                                                                            |
|----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| Data loss when Windows is reinstalled (the data is in AppData) | Daily backups also into a folder that the person chooses (FR-207)                                                     |
| A damaged library file loses all discussions at once           | Automatic backups of the database; `PRAGMA integrity_check` at start; export of each discussion                       |
| `node:sqlite` API changes in a later Electron                  | A thin adapter; library tests run with each Electron update; fallback `better-sqlite3`                                |
| The database and the blob files disagree after a crash         | File first, row second; a check at start lists rows without files and removes files without rows after a delay (Q-07) |
| Antivirus locks a blob file while the app writes it            | The same retry rule as for the discussion file today (`writeFileAtomically`)                                          |
| Two app instances (two Windows users) never share one library  | Each Windows user has an own library, as now with keys                                                                |

## 8. Alternatives kept for later

- Variant C2 (keep the original file up to date in the background) was not chosen. It can come back as an option
  ("Автоматически экспортировать в…") if people miss "the file is the discussion".
- Option E ideas (an event log) can come back if "Same person on two computers" (requirement item 21) needs a full
  history.

## 9. Questions

**Q-01.** What does a `.branchchat` file on disk mean after this change?

- (a) C1, library: opening imports a copy; the file is not changed again. Sharing is an explicit export.
- (b) C2, library with a mirror: the app keeps the original file up to date in the background, seldom.
- Recommendation: (a). It is simpler and it matches "export/import to share". (b) keeps the old habit "the file is the
  discussion", but costs more and keeps the moved-file and copy problems of today.

**Answer:** a

**Q-02.** Backups of the library (if Q-01 = a):

- (a) automatic daily copy of the database in `%APPDATA%\BranchChat\backups`, keep the last 7;
- (b) (a), and also a folder that the person chooses (for example in Documents or a cloud folder);
- (c) only manual "Резервная копия…".
- Recommendation: (b).

**Answer:** b

**Q-03.** Import of a discussion that is already in the library (same document ID):

- (a) ask: "Заменить", "Сохранить как отдельное обсуждение", or "Отмена";
- (b) always keep both (the new one gets a new ID);
- (c) merge messages by ID (new messages from the file are added; nothing is removed).
- Recommendation: (c) for messages and read marks, because messages have stable IDs and clocks; then (a) only if the
  two copies have conflicting branch titles or states.

**Answer:** c

**Q-04.** Journal mode of the library: WAL (faster, two more files next to the database) or rollback journal (one
file)? The library is in AppData, not shared, so recommendation: WAL.

**Answer:** WAL

**Q-05.** Images and attachments: BLOBs in the database, or files in a `blobs` folder by sha256? Recommendation: decide
in the design after a test with 1 GB of images; start with BLOBs in a separate table.

**Answer:** files in a blobs folder

**Q-06.** Migration: import all known files automatically at the first start, or ask the person file by file?
Recommendation: one question with a list ("Импортировать эти обсуждения?"), all selected.

**Answer:** as recommended

**Q-07 (new).** Unused blob files (a deleted draft image, an attachment of a discussion that was removed): when are
they deleted? Recommendation: at start, files without a database row that are older than 7 days are deleted; the
backups keep their own copies.

**Answer:** as recommended

**Q-08 (new).** Import of a file into a **synchronized** discussion that is in the library (same document ID, for
example an exported copy that came back): the merge adds messages that the other members may not have. Are these
messages then sent to the members through the shared folder?

- (a) no: they stay local, and the import says "N сообщений есть только у вас";
- (b) yes: they are sent as new events, with their original authors and times;
- (c) the import of a synchronized discussion is refused; the shared folder is the only source.
- Recommendation: (c). An exported copy has no sync data (FR-170), and messages of other authors cannot be signed by
  this member, so (b) is not possible with the current protocol.

**Answer:** c

## 10. Decision record

| Date       | Decision                                                                                             |
|------------|------------------------------------------------------------------------------------------------------|
| 2026-11-14 | Proposed: options A to E compared                                                                    |
| 2026-11-14 | Accepted: option C, variant C1; backups (b); merge (c); WAL; blob files; migration with one question |

