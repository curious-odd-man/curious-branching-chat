# ADR-003: Local storage of discussions

**Status:** Proposed (answer the questions in Section 9)  
**Date:** 2026-11-14  
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

## 5. Proposed decision

**Option C (a local SQLite library with `node:sqlite`; `.branchchat` ZIP for export and import).** Variant C1 or C2
is open (Q-01).

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
- Double-click on a `.branchchat` file: import (C1) or open with a mirror (C2), see Q-01.
- New commands: "Экспортировать…" (a `.branchchat` file to send), "Импортировать…", "Резервная копия…" (C1).
- "Отправить копию…" becomes "Экспортировать…".

### What changes in the code

| Area                            | Change                                                                                                                                                                     |
|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/main/document/`            | Stays for import and export (ZIP read and write, migrations, validation)                                                                                                   |
| New `src/main/library/`         | Database schema, migrations, queries, search index, blob storage for images and attachments                                                                                |
| `documentSession.ts`            | Reads and writes through the library; small transactions instead of whole-file writes                                                                                      |
| Sync (`syncService`, registry)  | The registry links a discussion ID to a shared folder, not a file path; moved-file handling (FR-168) and the detached copy (FR-154) are not needed for library discussions |
| Recent files, file association  | Recent files become the discussion list; the association imports (C1) or opens (C2)                                                                                        |
| FR-117 (copy changed elsewhere) | Replaced by the import rule: an import of a discussion that is already in the library asks what to do (Q-03)                                                               |
| Tests                           | Library unit tests; e2e tests move from "file on disk" to "library" plus export and import                                                                                 |

### Database outline (to be refined in the design)

- `discussion` (id, title, created, schema version, synced flag), `participant`, `thread`, `message` (with clocks and
  the rich text as JSON), `read_state`, `delivery`, `roster_member`, `asset` (sha256, mime, BLOB), `draft`, `reaction`,
  `attachment`, `search_index` (FTS5 over normalized text).
- One database file, rollback journal or WAL (Q-04), `PRAGMA foreign_keys = ON`, `trusted_schema = OFF`.
- A schema version table and forward-only migrations, as for the file today.

### Migration of existing files

- At the first start of the new version, the app offers to import the files from the recent list and the sync
  registry. Each file is validated as today, then imported. The original file is not deleted.
- A synchronized discussion keeps its conversation ID, roster, keys, and sync state; only the document port changes.

## 7. Risks

| Risk                                                           | Mitigation                                                                                      |
|----------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Data loss when Windows is reinstalled (the data is in AppData) | C2 keeps a file in Documents; C1 needs automatic backups (requirement FR-2xx, Q-02)             |
| A damaged library file loses all discussions at once           | Automatic backups of the database; `PRAGMA integrity_check` at start; export of each discussion |
| `node:sqlite` API changes in a later Electron                  | A thin adapter; library tests run with each Electron update; fallback `better-sqlite3`          |
| Large BLOBs make the database big                              | Images and attachments in a separate table; optional later: files in a folder by sha256         |
| Two app instances (two Windows users) never share one library  | Each Windows user has an own library, as now with keys                                          |

## 8. Alternatives kept for later

- Images and attachments as files in `%APPDATA%\BranchChat\blobs\<sha256>` instead of BLOBs (smaller database,
  faster backup). Decide in the design.
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
