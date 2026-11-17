# BranchChat: implementation plan for release 2

**Status:** Releases 2.1 to 2.5 (phases 1–16) done in code; Windows checks open (checklist sections Q to U)  
**Date:** 2026-11-16  
**Input:** `requirements-next.md` (ready, draft 4), `adr-003-local-storage.md` (accepted), `requirements.md`
(revision 13), `sync-protocol.md`  
**Base code:** release 1.5 (tag `release-1.5-done`)

Size per phase: S 1–2 days, M 3–7 days, L 1–3 weeks (one developer, with tests and documents).

---

## 1. Releases

Each release can ship alone. A later release needs the earlier ones.

| Release | Content                                            | Phases | Requirements          | File schema | Sync protocol     | Size  |
|---------|----------------------------------------------------|--------|-----------------------|-------------|-------------------|-------|
| 2.1     | Log file, diagnostics, text size, shortcuts, dates | 1–3    | 2.13, 2.11, 2.12, 2.5 | —           | —                 | M     |
| 2.2     | Local library, import, export, backups             | 4–7    | 2.1                   | —           | —                 | L + L |
| 2.3     | Discussion list, drafts, search, branch map        | 8–11   | 2.3, 2.6, 2.2, 2.8    | —           | —                 | L     |
| 2.4     | Reactions and file attachments                     | 12–14  | 2.4, 2.7              | version 3   | 3 new event types | L     |
| 2.5     | English user interface                             | 15–16  | 2.10                  | —           | —                 | M     |
| later   | Same person on two computers                       | —      | 2.9                   | —           | —                 | XL    |

Total without "later": about 10–14 weeks.

Changes to the order in `requirements-next.md`, section 4:

- The branch map moves to release 2.3 (it needs no file change).
- Reactions and attachments are in one release (2.4), so the export format changes once (schema version 3), not
  twice (Q-01).

## 1a. Progress

| Release | Phase                                  | State                                   | Notes                                                         |
|---------|----------------------------------------|-----------------------------------------|---------------------------------------------------------------|
| 2.1     | 1 — Log file and diagnostics report    | Done                                    | Tag `phase-2.1-done`                                          |
| 2.1     | 2 — Text size and keyboard shortcuts   | Done                                    | Tag `phase-2.2-done`                                          |
| 2.1     | 3 — Day separators and "jump to date"  | Done in code; **needs a Windows check** | Tag `phase-2.3-done`; Windows: checklist section Q            |
| 2.2     | 4 — Library core                       | Done                                    | Tag `phase-2.4-done`; one save at 20,000 messages: about 7 ms |
| 2.2     | 5 — Sessions, import, export           | Done                                    | Tag `phase-2.5-done`                                          |
| 2.2     | 6 — Migration of existing files        | Done                                    | Tag `phase-2.6-done`                                          |
| 2.2     | 7 — Backups and checks                 | Done in code; **needs a Windows check** | Tag `phase-2.7-done`; Windows: checklist section R            |
| 2.3     | 8 — Discussion list in the window      | Done                                    | Tag `phase-2.8-done`                                          |
| 2.3     | 9 — Drafts kept                        | Done                                    | Tag `phase-2.9-done`                                          |
| 2.3     | 10 — Search                            | Done                                    | Tag `phase-2.10-done`; 100,000 messages: well under 0.5 s     |
| 2.3     | 11 — Branch map                        | Done in code; **needs a Windows check** | Tag `phase-2.11-done`; Windows: checklist section S           |
| 2.4     | 12 — Schema version 3 and protocol     | Done                                    | Tag `phase-2.12-done`                                         |
| 2.4     | 13 — Reactions                         | Done                                    | Tag `phase-2.13-done` (one commit with phase 14)              |
| 2.4     | 14 — File attachments                  | Done in code; **needs a Windows check** | Tag `phase-2.14-done`; Windows: checklist section T           |
| 2.5     | 15 — Text lookup                       | Done                                    | Tag `phase-2.15-done`                                         |
| 2.5     | 16 — English texts, setting, installer | Done in code; **needs a Windows check** | Tag `phase-2.16-done`; Windows: checklist section U           |

### Implementation decisions of release 2.1

- The log redaction removes every run of 40 or more base64 or hex characters (keys, signatures, hashes). Paths and
  participant IDs stay (FR-322).
- The report reduces the sync state to safe fields: outbox items keep type, IDs, and times, but not the envelope;
  waiting and loading events keep type, IDs, and times; the processed list and sequence numbers become counts.
- The window's console errors, a crashed or blocked window process, uncaught errors, and unhandled rejections of the
  main process go to the log. electron-updater writes into the log, not to the console.
- The zoom keys are handled twice, without double steps: a real key press is caught by the main process
  (`before-input-event`) and never reaches the page; keys that do not pass the main process (for example from test
  tools) are caught by the page. Ctrl+mouse wheel is handled only by the page (one step per 100 wheel units); if
  Chromium zooms by itself, the saved size is put back.
- "Перейти к дате…" uses Ctrl+G (in the "Вид" menu, which also has the text size).
- Day separators come only before a later day: synchronized messages are ordered by clock, and computers with
  different clocks can put a message of yesterday after one of today.
- The day of a message uses the `Date` fields for the system time zone: a new `Intl.DateTimeFormat` per message cost
  about 1 s per 20,000 messages and made sending at 20,000 messages slower (found by the performance test).
- Fixes on the way: dialogs opened with a button take the focus, so Escape works (the calendar).
- The user guide is not changed (Q-08 of `requirements-next.md`).

### Implementation decisions of release 2.2

- Tables (`src/main/library/schema.ts`): `discussion` (list columns, revision, manifest, other discussion fields, member
  list, mark keys as JSON), `participant`, `thread`, `message`, `asset`, `blob`, `mark` (read and delivery marks, one
  row per message), `search_index` (FTS5, `unicode61`, rowid = message rowid), `meta`. Data with unknown extra fields
  stays JSON, so a discussion comes back exactly as it went in (tested with random change sequences).
- A save is a difference between two versions: object identity first (the domain functions return new objects only
  for what they change), then IDs. A `revision` column refuses a save that is based on an older version.
- One `DiscussionStore` per discussion is shared by its window and the sync engine; while a window is open, the
  store hands remote changes to the window's session. So an open and a closed synchronized discussion are written the
  same way, and `FilePort` is gone.
- Read marks of a synchronized discussion are sorted lists (`normalizeSynced`); they are written as a set difference.
- A file with a member list that is not registered here is imported as a normal discussion (sync data left out). A
  synchronized discussion is refused as an import target (FR-205a).
- Joining an invitation when the library already has the same discussion (an exported copy, or the copy of a lost
  identity): the old copy is kept under a new ID (`moveAside`); nothing is lost.
- A new discussion from an import takes the file name as its name (release 1.x showed the file name). The snapshot
  of an invitation keeps its title.
- "Новое обсуждение" and "Новое общее обсуждение…" ask for the name in the window (no save dialog).
- The registry keeps `filePath` of release 1.5 only for the migration; the sync starts only for registered
  discussions that are in the library.
- The start screen lists every discussion; the recent-files setting now sets the length of the File menu and the jump
  list. The old `recent.json` is read only, for the migration.
- Backups: a folder per backup (`library.sqlite` in rollback-journal mode and `info.json`) and an image pool next to
  them; a restore is done at the next start (the database is open while the app runs); test builds end instead of
  restarting. The daily backup runs a minute after start and then at every full hour if none was made that day.
- Test builds have one new hook, `__saveFault` (a failing save, FR-008); it is in the release leak check.
- Phase 4 task 5 (images from the blob store) was done in phase 5, with the session change.

### Implementation decisions of release 2.3

- Library schema version 2 (a backup is made first): `message.author_id` (unread counts in the list) and the table
  `draft` (discussion, branch, editor JSON, image hashes). The unread count is one query over the read marks (about
  25 ms for 100,000 messages); the list is sent to the windows at most every 150 ms; the File menu and the jump list
  are built again only when names or order change.
- One main window (the oldest open window). A discussion opens in place in the window that asked; without a window
  (tray, notification, Explorer, jump list) in the main window. Before the switch, the drafts and the discussion are
  saved; a failed save keeps the discussion on screen with a message. The branch of each discussion and the scroll
  position (the first visible message) are kept in the window.
- The list is on the left of a discussion; on the start screen the start screen's own list stays. Below a window
  width of 1000 px the list lies over the discussion and opens with ☰ (the smallest window is 720 px).
- Drafts: saved 0.4 s after the last change, and at once before the window closes or shows another discussion (the
  main process asks the page and waits up to 1.5 s). Images of a draft are written to the blob files and are kept by
  the cleanup. Sending removes the draft. The close question about drafts is gone (FR-254).
- Search: FTS5 prefix query of the normalized words (all words required); results: newest first for all
  discussions, in discussion order inside one. Branch titles are searched in JavaScript. The text around the match
  and the marks come from the original text. The highlight in the messages uses the CSS Custom Highlight API (no change
  of the message DOM). The global search opens from the menu, Ctrl+Shift+F, or the 🔍 button above the list.
- Shortcuts: new group "Поиск" (Ctrl+F, Ctrl+Shift+F, Enter, Shift+Enter); Ctrl+Shift+M opens the branch map.
- The branch map shows a closed branch on the way to an open one when "только открытые" is on (dimmed).

### Implementation decisions of release 2.4

- Q-01: reactions and attachments together, one export schema change (version 3). Q-02: new event types; the protocol
  version stays 1 (answers of 2026-11-16).
- Export schema version 3: `reactions` (emoji, person, on, clock) and `attachments` (name, size, type, sha256) per
  message; ZIP entries `attachments/<sha256>`. A removed reaction stays as `on: false`, so the last change of a person
  wins also in a merge. Reaction clocks count for the discussion clock.
- Library schema version 3: table `attachment` (keeps the files in the cleanup), column `draft.attachments`; the
  manifests in the library go to schema version 3. Reactions stay in the message JSON (no own table): they change with
  the message row, and the save writes only that row.
- `member.limits.set` is sent only when the own limit is not the default (30 MB), or was sent before and changed. A
  member without a value counts with 30 MB (FR-268), so a discussion where nobody changed the setting gets no new event
  type, and a 1.5 member does not see "Обновите приложение" because of it.
- Attachment parts that are larger than the receiver's limit stay in the inbox without a receipt; they are opened once,
  then skipped until the limit is raised. Attachment parts do not count for the delivery mark of the message.
- Phases 13 and 14 are one commit: both change the same message view, IPC channels, and texts.
- Reactions: ☺+ under each message (visible on mouse-over and with Tab focus); the picker works with the arrow keys,
  Enter, and Escape. A reaction needs the person's name (like a message) but no read notice.
- Attachments are stored in the library when they are attached (streamed, with the hash), so a draft keeps them
  (column `draft.attachments`) and sending writes only the message. A pasted file without a path is sent as bytes.
- "Наибольший размер вложения": 1 to 1 000 MB (FR-265 gives only the default).
- FR-268a: "(N МБ)" is the size of the file, rounded up.
- The search (FR-214) indexes the file names after the text of the message.
- "Открыть": a new folder with a random name in `%TEMP%\BranchChat\open` per open; copies older than 7 days are removed
  at start. Test builds record the file instead of opening it (`__openedFiles`, in the release leak check).

### Implementation decisions of release 2.5

- `src/shared/i18n/index.ts`: `texts()` returns the texts of the language; `Texts` is the type of `ru.ts` with string
  types widened, so `en.ts` must have the same keys and function signatures. 48 files changed from `ru.` to
  `texts().`; the three texts that were read when a module loaded are now read when they are shown.
- The main process sets the language from the settings before any text is shown. A window asks the main process once,
  synchronously, in the preload script (`window.branchchat.language`), so the first render has the right texts. No
  live switch (FR-293). "Перезапустить сейчас" closes the windows the normal way (drafts are saved) and starts again.
- English formats: `en-GB` (day, month, year; 24-hour time). Sorting of names follows the language.
- Installer: electron-builder `multiLanguageInstaller` with `ru_RU` and `en_US`, no language question. The texts of
  the own page in `installer.nsh` are chosen at run time from `$LANGUAGE` (1049 = Russian). The installer was not
  built in this environment (no NSIS): checklist section U.

## 2. Rules for all phases

- Each phase ends with: lint, typecheck, Prettier, all unit tests, all e2e tests, documents updated, and one commit
  with the tag `phase-2.N-done`.
- New interface texts go into `ru.ts` from phase 1. Release 2.5 adds `en.ts`; until then, no English texts.
- The release build must not contain test hooks (the existing check in `release.yml`); new hooks get new names in
  that check.
- `requirements.md` stays the base; implemented FR-2xx move into it at the end of each release (revision 14 and up).
  `requirements-next.md` stays the plan document until release 2.5 ships.

---

## 3. Release 2.1: small improvements

### Phase 1: log file and diagnostics report (S–M)

FR-321 to FR-324.

Tasks:

1. `src/main/log/logger.ts`: levels (info, warn, error), one line per entry with time and area (`sync`, `updates`,
   `background`, `library`, `app`). Files `%APPDATA%\BranchChat\logs\main.log`, rotation 5 × 2 MB. Writes are queued
   and never throw (FR-324; uses the EPIPE guard).
2. Replace the `console.log` calls in the main process. The updater gets this logger (`updater.logger`).
3. A redaction rule in one place: no message text, no discussion names, no keys. A unit test feeds known secrets and
   checks the files.
4. "Справка > Сохранить отчёт…": a dialog that lists the content (logs, versions, settings without the name, sync
   state without keys) and says that paths can contain the Windows user name; then a ZIP through the save dialog.
5. Uncaught errors in the main process and in the window go to the log.

Tests: unit (rotation, redaction, a failing disk), e2e (report ZIP content).

Exit: a report from a test run has no message text and no key material.

### Phase 2: text size and keyboard shortcuts (M)

FR-301, FR-302, FR-311, FR-312.

Tasks:

1. `src/shared/shortcuts.ts`: one table of all shortcuts (key, group, text key, action). The menu accelerators and the
   key handlers in the window read this table. Today the menu has 3 accelerators and the window has about 19 key
   handlers; each one moves to the table.
2. Text size: Ctrl+plus, Ctrl+minus, Ctrl+0, Ctrl+mouse wheel; 80–200 % in steps of 10 % (`webContents.setZoomFactor`).
   Kept in the settings, shown in Settings with a reset button. All windows use the same value.
3. F1 and "Справка > Сочетания клавиш": a dialog made from the table, grouped.
4. A unit test: every accelerator in the menu and every handler is in the table, and no key is used twice in a group.

Exit: the shortcut list shows every shortcut that the e2e tests use.

### Phase 3: day separators and "jump to date" (S)

FR-241, FR-242.

Tasks:

1. Separators in the virtualized message list ("Сегодня", "Вчера", the date in local time); the virtual row heights
   include them.
2. "Перейти к дате…": a calendar dialog; the days with messages in the current branch are marked; the choice scrolls
   to the first message of the day (the existing focus mechanism).
3. Unit tests for the day grouping (time zones, midnight, daylight saving time).

**Release 2.1 exit:** checklist section Q (new) on Windows: log rotation, report, zoom at 100–200 % display scale.

---

## 4. Release 2.2: local library

The largest change. After this release, `.branchchat` files are only for import and export (ADR-003).

### Phase 4: library core (L)

FR-201, FR-202.

Tasks:

1. `src/main/library/db.ts`: a thin adapter over `node:sqlite` (open, prepare, transaction, close). Nothing else
   imports `node:sqlite`, so a change to `better-sqlite3` stays in one file. Settings: WAL, `foreign_keys = ON`,
   `trusted_schema = OFF`, `busy_timeout`.
2. `schema.ts` and `migrations.ts`: the tables of ADR-003 section 6 (without reactions and attachments, which come in
   release 2.4), a schema version table, forward-only migrations.
3. `blobs.ts`: `blobs\<2 hex>\<sha256>`; write to a temporary file, check the hash, rename; the row comes after the
   file. Reads by hash. The cleanup rule of ADR-003 Q-07.
4. `repository.ts`: load a discussion as `DocumentContents` (the current domain model stays), and save a change as a
   diff in one transaction: new and changed messages, threads, read marks, delivery, roster. The diff uses IDs and the
   change stamps that schema version 2 already has.
5. The image protocol (`asset://`) reads from the blob store.
6. Search index: an FTS5 table with normalized text (lower case, ё → е), updated in the same transaction. Search
   itself comes in phase 10.

Tests: unit tests for each module; a property test (random change sequences: the library and an in-memory copy stay
equal); a crash test (a killed child process in the middle of a transaction leaves the old or the new state).

Exit: a discussion of 20,000 messages and 1 GB of images: one message saved in less than 0.1 s (NFR-202).

### Phase 5: sessions, import, export (L)

FR-203 to FR-205a, FR-204.

Tasks:

1. `DocumentSession` saves through the repository instead of `writeDocument`. The save queue stays; a save is now a
   small transaction.
2. Import: the ZIP is read and validated as today (`readDocument`, migrations, zod, integrity); then one transaction
   adds it, or merges it into a known discussion (ADR-003, "Merge on import"). The import of a file into a synchronized
   discussion is refused (FR-205a). The result says how many messages were added.
3. Export: "Экспортировать…" writes the current ZIP format with `writeDocument` from the repository data; a
   synchronized discussion without sync data. Replaces "Отправить копию…".
4. File association, drag and drop, `second-instance`, and "Импортировать…" import, then open.
5. "Новое обсуждение" makes a discussion in the library (no save dialog). The name is asked in the window.
6. Sync: the registry links a conversation ID to a shared folder (no file path). `FilePort` (closed files) and the
   moved-file and detached-copy logic (FR-154, FR-168) are removed; the sync engine writes into the library for open
   and closed discussions the same way.
7. The e2e helpers change: a test makes a discussion in the library or imports a file; checks that read the file on
   disk read an export instead. 14 of the e2e spec files touch `.branchchat` files today.

Exit: all existing e2e scenarios pass on the library; export → import on a clean profile gives the same discussion.

### Phase 6: migration of existing files (M)

FR-206.

Tasks:

1. At the first start of the new version: one dialog with the files from the recent list and the sync registry, all
   selected; missing files are shown as missing.
2. Each selected file is imported. A synchronized discussion keeps its conversation ID, roster, keys, sync state
   (`sync\<id>\state.json`), outbox, and shared folder.
3. The original files are not changed or deleted. A log entry per file.
4. The old recent list and registry are kept read-only for one release, then removed.

Tests: e2e with a profile of release 1.5 (normal and synchronized discussions, with images); after the migration, sync
continues with a 1.5 member.

### Phase 7: backups and checks (M)

FR-207 to FR-209.

Tasks:

1. Daily backup (first start of the day, or the next full hour) and before each library migration: the SQLite backup
   API plus new blob files; `backups\` and the folder of the person; the last 7 in each.
2. Settings: backup folder, "Резервная копия сейчас", the warnings of FR-209 (also the one-time warning for a cloud
   folder).
3. "Восстановить из резервной копии…": a list of backups with date and size; the current library becomes a backup
   first; then a restart.
4. At start: `PRAGMA integrity_check` (quick check), and rows without blob files. A damaged library: a message and the
   last good backup is offered; the damaged file is kept.

Tests: unit (rotation, incremental blobs, restore), e2e (backup and restore; a damaged database at start).

**Release 2.2 exit:** checklist section R (new): migration from a real 1.5 profile, backup into a Google Drive folder,
restore, a power cut during a write (pull the plug on a test machine or kill the process), antivirus on.

---

## 5. Release 2.3: navigation

### Phase 8: several discussions in one window (L)

FR-221 to FR-225.

Tasks:

1. The discussion list on the left: name, last message time, unread count, mark for synchronized discussions, mark for
   a draft (after phase 9); sort and filter; hide and width kept.
2. The window switches the discussion in place; each discussion keeps its branch and scroll position.
3. "Открыть в новом окне"; a discussion that is open in a window comes to the front instead of opening again.
4. The tray "Открыть", notifications, and the single-instance rules open a discussion in the main window.
5. Performance: the window gets only the open discussion; the list gets a short summary per discussion.

### Phase 9: drafts kept after a restart (S)

FR-251 to FR-254.

Tasks: drafts (text and image hashes) in the library, per discussion and branch; saved while typing (a short delay);
the close question about unsent drafts is removed; the list marks discussions with a draft.

### Phase 10: search (M)

FR-211 to FR-215, NFR-201.

Tasks:

1. The search service over the FTS5 index: the query is normalized like the text (lower case, ё → е), each word is a
   prefix search; results with author, time, branch, and a text part around the match.
2. Ctrl+F in a discussion: a field, next and previous (Enter, Shift+Enter), opens the branch and highlights the match.
3. Ctrl+Shift+F: all discussions, results grouped by discussion.
4. Branch titles and attachment names are indexed too (attachment names after release 2.4).

Tests: unit (normalization, prefixes, Cyrillic case), e2e (find in a closed branch; jump), performance (20,000 messages
in a discussion; 100,000 in the library: first results in less than 0.5 s).

### Phase 11: branch map (M)

FR-271 to FR-273.

Tasks: a tree view (title, state, message count, unread count), keyboard navigation, the current branch marked, filters
"только открытые" and "с непрочитанными"; a click opens the branch.

**Release 2.3 exit:** checklist section S (new): 20 discussions in the list, switching, two windows, search in
Russian with ё.

---

## 6. Release 2.4: reactions and file attachments

One export schema change (version 3) and three new sync event types for both features.

### Phase 12: schema version 3 and protocol additions (M)

Tasks:

1. Export schema version 3: `reactions` per message, `attachments` per message (name, size, type, sha256), entries
   `attachments/<sha256>` in the ZIP. Migration 2 → 3 (no data change). Version 2 apps refuse version 3 files with the
   existing message (FR-016).
2. `sync-protocol.md`: new event types, protocol version stays 1. Version 1.5 checks every object strictly (an unknown
   field is refused), but it keeps an event of an unknown type waiting and shows "Обновите приложение" (FR-269). So:
    - `reaction.set` (`{ messageId, emoji, on }`; the last change per person and emoji wins);
    - `member.limits.set` (`{ maxFileMb }`, FR-268);
    - `message.attachments` (`{ messageId, attachments: [{ name, size, type, sha256, parts }] }`, sent right after the
      `message.sent` of the same message) and `attachment.part` (the bytes, as `message.part` does for images). The
      parts need their own type: version 1.5 checks each `message.part` against the images of `message.sent` and would
      quarantine an attachment part (Q-02).
3. Library tables `reaction` and `attachment`.

Tests: schema tests (version 3 files, refusal of unknown fields, migration), protocol tests (old version waits; new
events converge under the random-fault test).

### Phase 13: reactions (M)

FR-231 to FR-234.

Tasks: the 7 emoji under a message (a small picker on mouse-over and on a key), counts, a list of names on mouse-over;
no unread state and no notification; sync with `reaction.set`.

### Phase 14: file attachments (L)

FR-261 to FR-268a.

Tasks:

1. Attach with a button, drag and drop, and paste; images keep their current behavior.
2. The limit setting "Наибольший размер вложения" (default 100 MB); a larger file is refused with the limit named.
3. Display: name, size, icon; "Сохранить как…"; "Открыть" (a temporary folder, then Windows opens the file).
4. A warning before "Открыть" for `.exe`, `.bat`, `.cmd`, `.ps1`, `.js`, `.vbs`, `.msi`, `.lnk`, `.docm`, `.xlsm`,
   with the type and the author; nothing blocked.
5. Mark of the Web on saved and opened files (an NTFS stream `Zone.Identifier` with `ZoneId=3`); a test on Windows
   that SmartScreen and Office Protected View react.
6. Sync: parts as for images; `member.limits.set` sent when the limit changes, after joining, and when a member is
   added; the sender's warning with names (FR-268); the receiver's "Файл слишком большой для ваших настроек" with a
   link to the setting (FR-268a).
7. A security review of this phase before the release (opening files, paths, names with control characters, very
   long names, the same hash with different names).

**Release 2.4 exit:** checklist section T (new): attachments of each warned type, Mark of the Web, a 1.5 member in the
discussion (sees "Обновите приложение", loses nothing), a member with a 30 MB limit.

---

## 7. Release 2.5: English user interface

### Phase 15: text lookup (M)

FR-291, NFR-205.

Tasks:

1. `src/shared/i18n/`: a `Texts` type from `ru.ts`; `en.ts` must have the same keys (a type check and a unit test).
   32 source files import `ru` directly today; they change to one function that returns the texts of the chosen
   language.
2. The language is chosen once at start (main process and window); no live switch (FR-293).
3. Date, time, and number formats follow the chosen language.

### Phase 16: English texts, setting, installer (M)

FR-291 to FR-295.

Tasks: all English texts (about 520 lines in `ru.ts` today, plus the texts of releases 2.1–2.4); "Язык / Language" in
Settings, default Russian, "Перезапустить сейчас"; the installer in both languages (electron-builder NSIS
`installerLanguages`), chosen from the Windows language; tray, notifications, and dialogs checked in English. The
documents and the user guide do not change (FR-294).

**Release 2.5 exit:** checklist section U (new): every screen in English at 100 % and 200 % text size; long English
texts do not break the layout.

---

## 8. Risks

| Risk                                                       | Release | Mitigation                                                                                     |
|------------------------------------------------------------|---------|------------------------------------------------------------------------------------------------|
| `node:sqlite` changes in a later Electron                  | 2.2     | One adapter file; library tests on each Electron update; fallback `better-sqlite3`             |
| Migration loses or changes data of a 1.5 profile           | 2.2     | Originals never changed; e2e with a real 1.5 profile; a backup before the migration            |
| The e2e suite change in phase 5 is larger than planned     | 2.2     | Change the helpers first (one place), then the specs file by file; keep both paths for a while |
| Data only in AppData after migration (Windows reinstall)   | 2.2     | Backups into the person's folder (phase 7); the first-start dialog suggests a backup folder    |
| A 1.5 member in a discussion with reactions or attachments | 2.4     | New event types only; 1.5 waits and shows "Обновите приложение"; nothing is lost               |
| Opening attachments is a new attack surface                | 2.4     | Mark of the Web, warnings, no automatic opening, a security review                             |
| Long English texts break dialogs                           | 2.5     | Checklist at 200 % text size                                                                   |

## 9. Questions

Q-01 and Q-02 are answered (2026-11-16): together in release 2.4; new event types.

**Q-01.** Reactions and attachments together in release 2.4 (one export schema change), or reactions first in an own
release (two schema changes: version 3, then version 4)? Recommendation: together.

**Answer:** together (2026-11-16).

**Q-02.** Attachments in a synchronized discussion: the list of attachments and their parts go in new event types
(`message.attachments`, `attachment.part`), because version 1.5 checks `message.sent` and `message.part` strictly. A 1.5
member then sees the message without its attachments, and "Обновите приложение". Alternative: raise the protocol
version to 2, so that version 1.5 refuses all new events until it is updated. Recommendation: the new event types (a
1.5 member keeps getting all other messages).

**Answer:** the new event types (2026-11-16).
