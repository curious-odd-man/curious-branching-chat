# BranchChat — Implementation Plan

**Inputs:** `branchchat_requirements.md` (revision 4), `adr.md` (ADR-001, Accepted)  
**Stack:** Electron + TypeScript, React, TipTap (ProseMirror), electron-builder (NSIS), electron-updater  
**Platform:** Windows 10 and Windows 11

---

## Progress

| Phase                                        | Status                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|----------------------------------------------|---------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0 — Foundation and packaging skeleton        | Done in code                                            | Scaffold, secure Electron shell, lint boundaries, CI, installer config. Electron smoke tests pass (3). **Still to do on Windows:** install the CI-built `BranchChat-Setup.exe` on clean Windows 10 and 11 machines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1 — Domain model and document format         | Done                                                    | 73 unit tests: schemas, context resolution, read-state rules, ZIP read/write, atomic save, malicious fixtures, 5,000 messages with large images.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2 — Application shell and document lifecycle | Done in code                                            | 90 unit tests and 15 Electron end-to-end tests (run on Linux under a virtual display). **Still to do on Windows:** try the flows with real Windows dialogs, paths, and the installed app.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3 — Chat UI and rich-text editor             | Done in code                                            | 123 unit tests and 23 Electron end-to-end tests. 5,000-message discussion: opens in about 1 s, 17 rows in the page, a sent message is visible in about 30 ms (measured on Linux under a virtual display). **Still to do on Windows:** try real keyboard layouts, clipboard pastes from Word and browsers, and Russian spell checking.                                                                                                                                                                                                                                                                                                                                                        |
| 4 — Branching                                | Done in code                                            | 150 unit tests and 33 Electron end-to-end tests. Selections across bold/italic/link, list items, heading+paragraph and paragraphs; three-level nesting; reopening the file restores structure, context and highlights. **Still to do on Windows:** real mouse selection feel and the "Reply to this" button position on high-DPI screens.                                                                                                                                                                                                                                                                                                                                                    |
| 5 — Unread messages                          | Done in code                                            | 157 unit tests and 40 Electron end-to-end tests (three consecutive full runs passed). Includes the two-person exchange: A writes, B reads and replies, A opens the returned file. **Still to do on Windows:** check the look of unread highlighting and the read marks in both light and dark system themes.                                                                                                                                                                                                                                                                                                                                                                                 |
| 6 — Images                                   | Done in code                                            | 181 unit tests and 52 Electron end-to-end tests (three consecutive full runs passed). Real clipboard paste, drop, file chooser, inline display, larger view, placeholders for missing/damaged data, a 20 MB picture sent and saved in about 1.4 s with typing unaffected. **Still to do on Windows:** paste from real Windows sources (Snipping Tool, browsers, Word), and drag from Explorer.                                                                                                                                                                                                                                                                                               |
| 7 — Windows integration                      | Done in code; **needs a Windows check**                 | 202 unit tests and 59 Electron end-to-end tests. The installer script (with the new "Files" page) compiles with makensis. Association logic is unit-tested against an in-memory registry, and the `reg.exe` output parser is unit-tested; Settings and the first-start question are covered end to end with an in-memory registry. **Not run on Windows:** the installer page, real registry writes, double-click, icons in Explorer. Use `docs/windows-test-checklist.md`; CI also runs `scripts/installer-smoke.ps1` (marked `continue-on-error` until it has passed once).                                                                                                                |
| 8 — Updates                                  | Done in code; **needs a real-release check on Windows** | 225 unit tests and 68 Electron end-to-end tests. The real electron-updater runs in the end-to-end tests against a local feed that looks like a GitHub release: found update with notes, date and size; download with progress; **a corrupted download is rejected and never becomes installable**; up to date; no downgrade; offline (manual check explains, automatic check stays silent); automatic checks off in Settings; no document or participant data in the requests. **Not run:** the installer replacing the running program on Windows, and a real GitHub Release (the owner in `electron-builder.yml` is still a placeholder). Use `docs/windows-test-checklist.md`, section H. |
| 9       - Security                           | Done                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Implementation decisions made in phase 1:

- Messages store `authorDisplayName` (name at the time of writing) so renaming a participant affects new messages only (
  FR-024).
- Assets are identified by their SHA-256; images are stored uncompressed in the ZIP and copied through unchanged when
  only the JSON changes.
- ZIP safety relies on the reader (unsafe names, duplicate entries, declared vs actual size), not on size limits (
  NFR-015).
- Files from a newer schema version are refused for reading and writing (FR-012).

Implementation decisions made in phase 2:

- "New discussion" asks for the participant name first if none is saved (the creator becomes a participant when the file
  is created). Sending a message asks for it too (FR-019). The name prompt is in the page; menu commands are forwarded
  to the page so both paths use the same flow.
- Each window shows one discussion. An empty start window is reused when a file is opened; otherwise a new window
  opens (FR-115). Files are recognized as already open case-insensitively and across different path spellings.
- Changes appear immediately and are written by a serialized, coalescing queue. A failed write keeps the changes in
  memory, shows an error with "Повторить", and closing then warns (FR-008). Closing waits for pending writes first.
- The main process pushes the full discussion to the window after every change. This is fine for now; phase 3 will
  switch to incremental updates if large discussions need it.
- Drag-and-drop opening is implemented (`webUtils.getPathForFile`) but not covered by an automated test, because it
  needs a real file dropped from the operating system.
- Test-only hooks (stubbed dialogs, isolated profile) are compiled in only by `electron-vite build --mode e2e`; the
  release build contains none of them (checked).

Implementation decisions made in phase 3:

- The editor (TipTap) is configured with exactly the formatting of requirements 4.3; everything else (code blocks,
  quotes, strike-through, images) is not in its schema, so it cannot be typed or pasted. The editor's single `textStyle`
  mark is converted to our separate `textColor` and `backgroundColor` marks when a message is sent (
  `sanitizeEditorDoc`), and the result is validated against the stored schema before it leaves the page and again in the
  main process.
- Messages are shown by building React elements from the stored structure, never from HTML. The renderer also ignores
  unknown nodes, unsafe links and non-plain colors, as a second line of defense.
- Links: the dialog accepts "example.com" (becomes https), email addresses (become mailto) and refuses everything except
  http, https and mailto. Clicking a link in a message asks the main process to open it in the system browser; the page
  itself never navigates. Hovering shows the destination.
- Text typed right after a colored or highlighted word keeps that color, as in other rich-text editors; the "no color"
  entry removes it.
- The message list is virtualized (TanStack Virtual). It opens at the newest message and scrolls to new messages only if
  the reader is at the bottom or wrote the message; someone reading older messages is not pulled away.
- The main process still sends the whole discussion after every change. At 5,000 messages a sent message appears in
  about 30 ms, so incremental updates are not needed yet.
- Not covered by automated tests: real pastes from Word or a browser (a synthetic HTML paste is tested), screen readers,
  and visual checks at 125–200% display scaling (phase 9).

Implementation decisions made in phase 4:

- Selection ranges are offsets in the message's plain text (`linearize`), shared by the renderer and the stored data.
  Each rendered piece of text carries its offset, so selecting across bold, italic, link, list items and paragraphs maps
  back exactly. The quote is taken from the stored message by the main process, not from the window.
- "Reply to this" appears after a selection is finished (mouse released or keyboard selection) and only when the
  selection lies inside one message, including inherited context. Replying marks the source message as read (FR-112).
- A branch created from an inherited message becomes a sibling in the thread that message belongs to, not a child of the
  branch being viewed (FR-056).
- A closed branch takes no new messages until reopened (new FR-126); the composer shows a notice with a reopen button.
  Please confirm this is what you want.
- Side panel: Active and Closed groups; a branch hangs under its nearest ancestor with the same status, and is labelled
  with its real parent when that is in the other group (FR-127).
- Each thread keeps its own unsent draft when moving between branches (FR-128); closing warns if any thread has one.
- Branch badges show how many branches start from a message (a short list when there are several); "go to source" opens
  the parent thread scrolled to the message and flashes it. Quoted passages are not marked in the parent thread (only in
  the branch's inherited context); this could be added later.

Implementation decisions made in phase 5:

- Read state lives in the file (`readstate.json`) and is changed only through the main process: explicit "Mark as
  read" (message, thread, everything), sending a message in a thread (reads that thread's earlier messages), and "Reply
  to this" (reads the source message). Opening or scrolling a thread never changes it.
- The one-time notice (FR-125) is enforced by the main process: any action that would change the person's read state is
  refused with a "notice required" answer until the notice was confirmed; the window then shows it and repeats the
  action. Declining changes nothing. The "would it change anything?" check means a first message in an empty discussion
  does not show the notice.
- Marking something read needs a participant name (the person is added to the file's participants on that first write),
  so the name prompt comes before the notice.
- "Mark thread as read" marks the thread's own messages. Unread messages in inherited context belong to their own
  threads and can be marked on the message itself.
- The read indicator is one green check (some have read it), two green checks (all), and no mark when nobody else has
  read it (changed by D-41; before: one grey check, two grey checks, two accent-colored checks); names in the tooltip
  and in a list that opens on click. Because the local person only becomes a "known
  participant" after their first read-state change, marking one message read can turn other messages from "read by all"
  to "read by some" (they have not read those). This follows FR-124.
- Three test flakes were fixed in the tests, not the application: the editor test pressed a key before focus returned
  from the link dialog, and two close-the-last-window steps raced with the app quitting.

Implementation decisions made in phase 6:

- Images go through the main process: pasted/dropped bytes or a chosen file are checked by their first bytes (PNG, JPEG,
  GIF, WebP; SVG is refused), hashed, and kept in memory as part of the draft. They are written to the file only when a
  message using them is sent (new FR-129); one removed from the draft or never sent leaves no trace. There is no size
  limit.
- The window shows images through an app-only `bcasset:` address that contains a random per-window id and the image's
  SHA-256. The main process answers only for open discussions, verifies type and checksum, and answers 404 for missing
  or damaged data, which shows as a placeholder (FR-131). The page's content security policy allows `img-src bcasset:`
  and nothing remote.
- Images are inline nodes in a paragraph; they add nothing to a message's plain text, so selections, quotes and branch
  offsets are unaffected (FR-133, tested around a picture).
- Pasting: if the clipboard has both text and an image, the text is pasted (FR-130); an image-only clipboard inserts the
  image. HTML pasted from elsewhere cannot create an image.
- A picture at the bottom of a list keeps the list scrolled to the end after it loads. Pictures in messages are shown at
  most about 28 rem wide and 20 rem tall; the larger view shows them as big as the window allows.
- Clipboard test note: this Electron version has the asynchronous, web-style clipboard in the main process (
  `write([ClipboardItem])`), which the real-clipboard test uses.

First run of the test suite on Windows (by the project owner) found six failures, all in the tests, none in the
application:

- Five tests passed but failed afterwards while deleting their temporary profile folder: on Windows, Chromium's helper
  processes can keep files locked for a moment after the app has closed (`EPERM`). Cleanup now retries for a few seconds
  and never fails a test; a folder that cannot be removed is left in the temp directory.
- One branching test read the branch context before the new branch had opened (it waited for "a branch header is
  visible", which was already true when replying from inside a branch). `replyTo` now waits until the shown thread
  actually changes. The same wait was added in one unread test. Both groups of tests also passed under heavy CPU load on
  Linux.

Implementation decisions made in phase 7:

- The association is **not** done with electron-builder's `fileAssociations`, which registers silently. A custom NSIS
  include adds a "Файлы обсуждений" page with a checkbox (ticked by default; say if you would rather have it unticked)
  and writes the keys under HKCU only when ticked and when no other program holds `.branchchat`. Silent installs and
  updates never change it; the uninstaller removes it unless it is the first step of an update (`isUpdated`).
- The app does the same through `reg.exe` (no native dependency): Settings can switch it on or off, and a first-start
  question is asked once, only if the installer did not ask and the type is free. Another program's claim, including a
  choice made in Windows' own "Open with", is never overridden.
- Added File > Settings… (Ctrl+,): participant name (new name applies to new messages only) and the association.
- New icons (a blue rounded square with a branch; a page with a folded corner and a branch) are generated by
  `scripts/make-icons.mjs`; the files are committed. They are first drafts: replace `build/icon.ico` and
  `build/document.ico` with your own artwork at any time.
- The installer was compiled on Linux by giving electron-builder a stand-in for Wine; that checks the script's syntax
  and page order (it reports 4 installer pages), not its behavior.
- `app.setAppUserModelId('app.branchchat.desktop')` is set on Windows for taskbar grouping.
- Stale-path case not handled: if the program is moved after registering, the registered command still points to the old
  path until the association is switched off and on in Settings.

Implementation decisions made in phase 8:

- Updates use electron-updater's `NsisUpdater` (GitHub provider) behind a small `UpdaterPort`; the flow lives in
  `UpdateService`. Nothing is downloaded until the person clicks "Скачать"; a downloaded update installs on "
  Перезапустить и установить" or silently when the application is next closed. No custom request headers are added.
- An automatic check (20 s after start, then every 6 h, unless turned off in Settings) never opens a dialog: a new
  version shows a small banner, and "nothing new" or "offline" shows nothing. Help > Check for updates always answers.
- Release notes (HTML from GitHub) are converted to plain text and shown as text only.
- The "open release page" address is built in the main process from the repository in `app-update.yml` and the version;
  the window never supplies an address.
- Test builds can point the real updater at a local folder URL (`BRANCHCHAT_E2E_UPDATE_FEED`) and only count the install
  request; release builds contain none of this.
- A downgrade is never offered (`allowDowngrade` off), and prereleases and drafts are ignored.
- Still open: replace `YOUR_GITHUB_USER` in `electron-builder.yml`; the repository must be public so no token is
  embedded.

---

## 1. Approach

1. **Domain first.** The discussion model, branching rules, context resolution, read-state rules, and the file format
   are plain TypeScript with no Electron or React dependency. They are built and tested before any UI.
2. **Always shippable.** An installer is built and installed on a clean Windows machine from the first phase onward, so
   packaging problems show up early instead of at the end.
3. **Risk early.** The riskiest feature, selecting text across formatting and anchoring a quote for "Reply to this",
   is built as soon as the editor exists (phase 3), not at the end.
4. **Vertical slices.** Each phase ends with something a person can run and try.
5. **Requirements traceability.** Every phase lists the requirements it completes; section 5 shows the full mapping.

Effort sizes are rough, for one developer working full time: **S** ≈ up to 3 days, **M** ≈ about a week,
**L** ≈ about two weeks. They are planning aids, not commitments.

## 2. Tooling decisions

| Area                | Choice                                                                                    |
|---------------------|-------------------------------------------------------------------------------------------|
| Package manager     | pnpm (or npm; pick one and lock it)                                                       |
| Build               | electron-vite (Vite for main, preload, and renderer)                                      |
| Language            | TypeScript, `strict` on, no implicit any                                                  |
| UI                  | React; plain CSS modules or a small CSS approach (no heavy UI kit needed)                 |
| Editor              | TipTap with a restricted extension set                                                    |
| Validation          | zod schemas shared by main, preload, and renderer                                         |
| ZIP                 | A maintained library with streaming read and write                                        |
| IDs                 | `crypto.randomUUID()` for document, participant, message, thread IDs                      |
| Unit tests          | Vitest (domain, document, validation)                                                     |
| Component tests     | Vitest + Testing Library for React components                                             |
| End-to-end tests    | Playwright with Electron support                                                          |
| Lint / format       | ESLint (with import-boundary rules) + Prettier                                            |
| CI                  | GitHub Actions on `windows-latest`                                                        |
| Packaging / updates | electron-builder (NSIS, per-user) + electron-updater (GitHub provider)                    |
| Localization        | Russian only; strings in one dictionary module so they are never hard-coded in components |

**Import boundaries (enforced by lint):** `shared/domain` and `shared/validation` may not import Electron, React,
Node built-ins, or anything from `main/` or `renderer/`. `renderer/` may not import `main/` or Node built-ins.
`main/` may import `shared/`.

## 3. Phases

### Phase 0 — Foundation and packaging skeleton (M)

**Goal:** a signed-off skeleton that builds, tests, packages, and installs.

Tasks

- Create the repository from the structure in ADR section 5.3; archive the old JavaFX project (ADR section 12).
- Configure TypeScript, electron-vite, ESLint (import boundaries), Prettier, Vitest, Playwright.
- Electron shell with the secure defaults from ADR section 7.1: `nodeIntegration` off, `contextIsolation` on, sandbox,
  strict Content Security Policy, navigation and new-window blocking, empty preload bridge.
- Russian string dictionary and a helper for dates and times in the local time zone.
- GitHub Actions: install, lint, type-check, unit tests, build, produce the NSIS installer as a build artifact.
- electron-builder configuration: per-user install, application icon, `.branchchat` file association declared (not yet
  functional).
- Manual install of the CI-built installer on a clean Windows 10 and a clean Windows 11 virtual machine, without
  administrator rights.

Exit criteria

- CI is green and produces `BranchChat-Setup.exe`.
- The installer installs and starts an empty window on both clean machines; uninstall removes it.
- Lint fails if a boundary rule is broken (demonstrated with a test import).

Requirements: groundwork for FR-082 to FR-084, NFR-002, NFR-010.

### Phase 1 — Domain model and document format (L)

**Goal:** a tested library that can create, read, modify, and write `.branchchat` files, with no UI.

Tasks

- **Domain types and rules** in `shared/domain`: discussion, participant, thread, message, branch; creating a message
  (assigns `sequence`), creating a branch from a message and quote, closing and reopening a branch, branch hierarchy.
- **Context resolution:** for a branch, return parent-thread messages up to and including the source message,
  recursively up to the main thread (requirements 4.5); exclude later parent messages and sibling branches.
- **Read-state rules** (FR-108 to FR-112, FR-120):
    - unread = authored by another participant and not in the local participant's read set;
    - mark one, mark thread, mark all;
    - sending a message in a thread reads all earlier messages in that thread;
    - creating a branch reads the source message;
    - only the local participant's entry is changed; other entries are preserved;
    - query "who has read message M": known participants except the author whose entry contains M, with the states
      read by all / some / none (FR-122 to FR-124).
- **Schemas** in `shared/validation`: manifest, discussion, read state, rich-text content subset (ADR section 5.4),
  with `schemaVersion` and a migration framework (initially version 1 only, but the mechanism exists).
- **Document module** in `main/document`:
    - read a ZIP as streams; validate entries and schemas;
    - write with a temporary file in the same folder and atomic replace, with retry and backoff on `EPERM`/`EBUSY`;
    - copy unchanged entries through without recompression;
    - do not keep the file handle open between operations;
    - preserve unknown optional fields (FR-015);
    - refuse to rewrite a file whose `schemaVersion` is newer than supported (FR-012) and report it clearly;
    - image assets stored by content hash (deduplication), only PNG/JPEG/GIF/WebP (FR-116).
- **Fixtures:** a set of sample `.branchchat` files: minimal, with nested branches, with images, unknown fields, newer
  schema, truncated ZIP, wrong sizes, path traversal entry, malformed JSON, unknown rich-text nodes, missing asset.

Tests

- Round trip: write, read, compare, for every fixture that is valid.
- Context resolution on a 3-level nested example, including branches created from inherited context.
- Every read-state rule above, including "only own entry changes".
- Malicious and malformed fixtures are rejected or degrade safely with a useful error (FR-009, NFR-014).
- Kill-the-process-mid-write test: the original file is intact after an interrupted save.
- A discussion with several thousand messages and several large images reads and writes correctly (no limit is
  enforced; this is a correctness and memory check).

Exit criteria

- All tests pass in CI. A command-line script can create a discussion, add messages and branches, and read it back.

Requirements: FR-001 to FR-004, FR-007, FR-009 to FR-015, FR-020 to FR-025, FR-051 to FR-064 (rules only),
FR-070, FR-075 (rules), FR-080, FR-081, FR-108 to FR-112, FR-114, FR-116, FR-120 to FR-122, NFR-005, NFR-009,
NFR-014, NFR-015.

### Phase 2 — Application shell and document lifecycle (M)

**Goal:** the app can create, open, and autosave discussions, and handle Windows file launches.

Tasks

- IPC layer: typed, schema-validated channels; the renderer asks the main process for "open discussion", "append
  message", and so on, never touching the filesystem.
- **Document session** in the main process: holds the in-memory discussion, a serialized write queue (one write at a
  time, coalescing quick successive changes), error state for failed writes.
- **New discussion:** Save dialog first, file created immediately (requirements 4.1). **File > Open** dialog and
  drag-and-drop of a `.branchchat` file onto the window (FR-091, FR-092).
- **Participant settings:** name and generated participant ID in the per-user application data folder; name prompt
  before the first message if none exists; participant added to the document on first write (FR-017 to FR-024).
- **Windows:** one window per document (FR-115); single-instance lock; path arguments at launch and in the
  `second-instance` event; a file already open focuses its window; invalid path shows a clear error (FR-118);
  same `documentId` from a different path shows the two-copies notice (FR-117).
- Close handling: warn only for an unsent non-empty draft or a failed last write (FR-008).
- Error dialogs for damaged files and newer schema versions (FR-009, FR-012).
- Minimal temporary UI: a plain text composer and message list so the lifecycle can be exercised.

Tests

- Playwright: create, send, close, reopen; open two documents; open the same file twice; launch with a bad path.
- Simulated write failure (read-only file): the app reports it and does not lose the draft.

Exit criteria

- From the installed app, a discussion created on one machine opens correctly on another.

Requirements: FR-003 to FR-009, FR-017 to FR-024, FR-088 (behavior, not association), FR-091, FR-092, FR-115,
FR-117, FR-118.

### Phase 3 — Chat UI and rich-text editor (L)

**Goal:** the real chat interface and composer, including the riskiest interaction.

Tasks

- **Message list:** virtualized, in `sequence` order, author and local-time timestamp on every message, auto-scroll
  behavior that does not fight the user, correct Cyrillic, `ё`/`Ё`, and emoji rendering (FR-026 to FR-029, FR-034,
  FR-076 to FR-081, NFR-004).
- **Composer (TipTap)** with only the supported extensions: headings 1–3, bullet and numbered lists (nested), bold,
  italic, underline, text color, background color, link with label and URL, automatic recognition of plain URLs
  (FR-036 to FR-045, FR-048, FR-071, FR-072). Formatting toolbar and keyboard shortcuts, in Russian.
- Sent messages are rendered read-only from the stored structured content (never HTML) and are not editable
  (FR-047, FR-114).
- **Links:** open only on explicit click, and only `http`, `https`, `mailto`; never fetch remote content
  (FR-073, FR-074, NFR-014).
- Handle a round trip of every formatting feature: save, close, reopen, compare.

Tests

- Component and Playwright tests for each formatting feature and its round trip.
- Rendering test with a 5,000-message discussion: scrolling and typing stay smooth (measured and recorded, not a
  requirement limit).
- Security tests: a message containing script-like text and unsupported nodes renders as inert content.

Exit criteria

- Two people can exchange a `.branchchat` file and read each other's formatted messages.

Requirements: FR-026 to FR-029, FR-034, FR-036 to FR-048, FR-071 to FR-074, FR-076 to FR-081, NFR-003, NFR-004.

### Phase 4 — Branching (L)

**Goal:** "Reply to this", branch context, nested branches, and the side panel.

Tasks

- **Selection handling:** detect a non-empty selection inside a sent message (including inside inherited context and
  across formatting boundaries); show the floating **"Reply to this"** action (FR-049, FR-050).
- **Anchor capture:** compute the quote text and the selection range in the message's content model; store
  `sourceMessageId`, `quoteText`, `selectionStart`, `selectionEnd` (FR-051, FR-052, FR-055).
- **Branch view:** inherited context (read-only, visually distinct) followed by the branch's own messages; the quoted
  passage highlighted; fall back to quote-text search if the stored range does not match the quote (FR-053, FR-054,
  FR-062, FR-063).
- **Side panel:** hierarchy tree, branch path, Active / Closed groups, click to open, "go to source message"
  (FR-030 to FR-033, FR-061).
- **Branch actions:** optional title, close, reopen; closing a parent leaves children unchanged (FR-058 to FR-060,
  FR-064).
- **Message badges:** each message shows how many branches start from it (FR-035).
- Nested branches from any message, including from inherited context (FR-056, FR-057).

Tests

- Selections that span: bold + italic + link, list items, a heading and a paragraph, multiple paragraphs.
- Branch from a message already inside a branch, three levels deep; context shown matches section 4.5 exactly.
- Reload the file and verify every highlight and context path is restored.
- Sibling branch content never appears in another branch's context.

Exit criteria

- The core product scenario works end to end: select, reply, branch, nest, close, reopen, send the file back.

Requirements: FR-030 to FR-033, FR-035, FR-049 to FR-064, acceptance criteria 11 to 16.

### Phase 5 — Unread messages (M)

**Goal:** unread highlighting and read-on-reply, with the state stored in the file.

Tasks

- Wire the domain read-state rules (phase 1) into the UI via IPC; read-state changes go through the autosave queue
  (FR-007, FR-121).
- Unread styling on messages in threads and in inherited context (FR-110); explicit **"Mark as read"** on a message,
  and "Mark thread as read" / "Mark all as read" actions (FR-111).
- Implicit read: sending a message reads earlier messages in that thread; "Reply to this" reads the source message
  (FR-112). Confirm that scrolling and opening a thread do not mark anything read.
- Side panel: unread count per branch and an indicator on ancestors with unread descendants; total unread in the
  window title or header (FR-113).
- Participant entries of other people are preserved untouched on every write (FR-120).
- **Read status display:** a compact indicator on every message (for example check marks) showing read by all, some,
  or none of the other known participants; names shown on hover or click; the author is not listed
  (FR-122 to FR-124). Participants who never wrote to the file are not shown.
- **Privacy notice:** a one-time notice, before the first read-state write on a computer, that read status is visible
  to other participants (FR-125); the notice is remembered in local settings.

Tests

- Scenario: A writes, B opens (all unread), B marks one message read, B replies in the branch, B sends the file back;
  A opens it, sees B's read status on the right messages, and B's own messages as unread for A.
- Indicator states with two and three participants (all / some / none); a participant without an entry is not shown.
- Counting rules, including ancestors and inherited context.

Exit criteria

- Acceptance criterion 22 passes.

Requirements: FR-108 to FR-113, FR-120 to FR-125.

### Phase 6 — Images (M)

**Goal:** embedded images with inline display.

Tasks

- Paste from the clipboard (including screenshots), drag and drop into the draft, and add from a local file
  (FR-065 to FR-067).
- Embed in `assets/images/`, deduplicated by content hash; inline rendering from embedded assets; click to view
  larger (FR-066, FR-068 to FR-070).
- Placeholder for a missing or unreadable asset; the discussion still opens (FR-075).
- Reject unsupported types (FR-116), without any size limit (NFR-015).
- Check the autosave path with large images: unchanged entries are copied, not recompressed, and typing stays
  responsive while a save is running.

Tests

- Paste, send, close, reopen; move the file to another machine and reopen.
- Corrupt and missing image entries; an SVG rejected; a very large image handled without freezing the UI.

Requirements: FR-065 to FR-070, FR-075, FR-116, acceptance criteria 8 and 9.

### Phase 7 — Windows integration (M)

**Goal:** `.branchchat` double-click works, with consent.

Tasks

- Installer: custom NSIS include that shows an "Associate .branchchat files with BranchChat" option and registers
  the association for the current user only when selected (FR-089, FR-090). If this proves impractical, implement the
  fallback from ADR section 4.3: a first-run consent dialog writing under `HKCU\Software\Classes`.
- Settings screen: register and unregister the association; display the current state; uninstall removes it
  (FR-089).
- Document icon for `.branchchat` files and a friendly type name in Explorer.
- Test on clean Windows 10 and 11 virtual machines: install without administrator rights, double-click with and
  without the app running, double-click a file with a Cyrillic or very long path, a file on a network share, a file
  inside a synced folder.
- Update preserves the association (verified again in phase 8).

Exit criteria

- Acceptance criteria 20 and 21 pass on both clean machines.

Requirements: FR-082 to FR-090, FR-118, NFR-010 to NFR-012.

### Phase 8 — Updates (M)

**Goal:** safe updates from GitHub Releases.

Tasks

- Configure electron-updater with the GitHub provider; stable releases only, drafts and prereleases ignored
  (FR-093, FR-094).
- Background check at startup and periodically; manual **Help > Check for updates**; setting to disable automatic
  checks (FR-095 to FR-097).
- Update dialog: version, release date, release notes, download size; "open release page" (FR-098, FR-099).
- Download the correct artifact; verify checksum (publisher signature only if signing is added later); refuse to
  install on failure
  (FR-100 to FR-102, FR-119).
- Apply on restart; the app is closed during replacement (FR-106). Settings and the association survive
  (FR-103). Discussion files are never touched (FR-104).
- Offline and failure handling: errors reported, the app keeps working (FR-105). The update request carries no
  document or participant data (NFR-008): verify by inspecting network traffic.
- Test against a private test repository with real releases: normal update, corrupted download, interrupted
  download, interrupted install, offline start.

Exit criteria

- A version N installed on a clean machine updates to N+1 from a real GitHub Release; a corrupted release is
  rejected and N keeps working.

Requirements: FR-093 to FR-107, FR-119, NFR-008, acceptance criteria 18 and 19.

### Phase 9 — Hardening and release (L)

**Goal:** a releasable 1.0.

Tasks

- **Security review** against ADR section 7: Electron settings, CSP, IPC validation, navigation blocking, link
  protocol allowlist, ZIP safety, rich-text sanitization; run the malicious fixtures through the packaged app.
- **Performance pass:** large discussions (thousands of messages, many images), startup time, memory use, autosave
  cost; fix hot spots. Record results; there are no fixed limits to enforce.
- **Display and input:** 100%, 125%, 150%, 200% scaling; multi-monitor; keyboard navigation and shortcuts for the
  main actions; focus handling; high-contrast sanity check (NFR-003).
- **Russian text:** Cyrillic input, `ё`/`Ё`, emoji, mixed text; confirm that spell checking works offline with the
  Russian dictionary, and decide what to do if it does not.
- **Real-world exchange test:** send `.branchchat` files through WhatsApp (phone to desktop and desktop to desktop,
  WhatsApp Desktop and WhatsApp Web) and confirm the extension and content are unchanged and the file opens;
  note the behavior when WhatsApp renames duplicates.
- **Unsigned release (decided):** write the SmartScreen guidance ("More info", then "Run anyway", with screenshots)
  into the release notes template, the README, and the user guide; publish the installer's SHA-256 checksum in every
  release; enable two-factor authentication and restrict write access on the GitHub repository; build releases only in
  CI (NFR-016, FR-119).
- **Release automation:** tagging builds the installer in CI, uploads the installer, `latest.yml`, and blockmap to a
  GitHub Release, and publishes it as a stable release; prereleases are used only for testing.
- **Documentation:** short user guide in Russian (install, associate, create, branch, unread, exchange the file,
  update); developer README (build, test, release).
- Full acceptance run against section 9 of the requirements on clean Windows 10 and 11 machines.

Exit criteria

- Every acceptance criterion in the requirements passes on both Windows versions; version 1.0.0 is published as a
  stable GitHub Release.

Requirements: NFR-003, NFR-004, NFR-014, NFR-016, acceptance criteria 1 to 24.

**Status (revision 10 of the plan):** implemented and automated: security hardening and tests (`security-review.md`),
performance pass (`performance.md`), display/keyboard/focus/high-contrast tests, Russian text tests, release workflow,
documentation (`user-guide.ru.md`, `release-process.md`, `release-notes-template.md`, `acceptance.md`). Needs real
Windows machines and the user's GitHub account (checklist section I): WhatsApp exchange, real scaling and contrast
themes, SmartScreen screenshots, the acceptance run on clean Windows 10 and 11, and publishing 1.0.0.

## 4. Schedule overview

| Phase | Name                              | Size | Depends on |
|-------|-----------------------------------|------|------------|
| 0     | Foundation and packaging skeleton | M    | —          |
| 1     | Domain model and document format  | L    | 0          |
| 2     | Application shell and lifecycle   | M    | 1          |
| 3     | Chat UI and rich-text editor      | L    | 2          |
| 4     | Branching                         | L    | 3          |
| 5     | Unread messages                   | M    | 4          |
| 6     | Images                            | M    | 3          |
| 7     | Windows integration               | M    | 2          |
| 8     | Updates                           | M    | 7          |
| 9     | Hardening and release             | L    | all        |

Phases 6 and 7 are independent of 4 and 5 and can be reordered or interleaved. A single developer should expect
roughly 10 to 14 weeks in total; treat this as an estimate that the first two phases will refine.

## 5. Requirements coverage

| Requirements                               | Phase(s)               |
|--------------------------------------------|------------------------|
| FR-001 to FR-015, FR-114, FR-116           | 1, 2                   |
| FR-016 to FR-025                           | 1, 2                   |
| FR-026 to FR-029, FR-034                   | 3                      |
| FR-030 to FR-033, FR-035, FR-049 to FR-064 | 4                      |
| FR-036 to FR-048                           | 3                      |
| FR-065 to FR-075                           | 3 (links), 6 (images)  |
| FR-076 to FR-081                           | 3, 9                   |
| FR-082 to FR-092, FR-118                   | 0, 2, 7                |
| FR-093 to FR-107, FR-119                   | 8                      |
| FR-108 to FR-113, FR-120 to FR-125         | 1 (rules), 5 (UI)      |
| FR-115, FR-117                             | 2                      |
| NFR-001 to NFR-013, NFR-017                | 0 to 9 (verified in 9) |
| NFR-014                                    | 1, 3, 9                |
| NFR-015                                    | 1, 6, 9                |
| NFR-016                                    | 9                      |

## 6. Testing strategy

- **Unit tests (most of the effort):** domain rules, context resolution, read-state rules, schema validation,
  ZIP read/write, migration framework. Run on every commit.
- **Component tests:** editor toolbar behavior, message rendering, side panel, unread indicators.
- **End-to-end tests (Playwright + Electron):** the main scenarios from section 4 of the requirements, run against
  the built application in CI.
- **Fixture library:** the valid and malicious `.branchchat` files from phase 1 are reused by every later phase.
  Fixtures written by older application versions are kept, so each release is tested for opening older files.
- **Clean-machine tests:** installer, association, and update tests run on fresh Windows 10 and Windows 11 virtual
  machines at the end of phases 0, 7, 8, and 9.
- **Manual exploratory test of the exchange scenario:** two people, two computers, WhatsApp, a branched discussion
  with images, before each release.

## 7. Risks and mitigations

| Risk                                                        | Mitigation                                                                                                                    |
|-------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| Quote anchoring breaks across complex formatting            | Built and tested in phase 4 right after the editor; quote text is the durable fallback; broad selection test matrix           |
| Frequent autosave of large files is slow or fragile         | Copy unchanged ZIP entries raw; write queue with coalescing; atomic replace with retry; tested with large fixtures in phase 1 |
| Antivirus or sync tools lock the file during replace        | Retry with backoff; do not hold the file open; clear error if it still fails                                                  |
| Installer consent for the file association is hard in NSIS  | Fallback in-app consent dialog (ADR section 4.3); decided in phase 7                                                          |
| SmartScreen and antivirus warnings on an unsigned installer | Documented in release notes, README, and user guide; checksum published; signing can be added later                           |
| GitHub account compromise would allow a malicious update    | Two-factor authentication, restricted write access, CI-only release builds                                                    |
| Updater failure leaves a broken install                     | Test corrupted and interrupted updates in phase 8; previous version must remain usable                                        |
| Malicious or malformed files received through WhatsApp      | Schema validation, no HTML rendering, ZIP safety, link allowlist; fuzz-style fixtures                                         |
| Electron security regressions over time                     | Lint rules for dangerous settings; scheduled dependency and Electron updates; security checklist in release process           |
| Russian spell checking unavailable offline                  | Verify in phase 9; fall back to the operating system spell checker or document the limitation                                 |
| WhatsApp alters or blocks the `.branchchat` extension       | Test in phase 9; if blocked, document a workaround (for example sending as a ZIP and renaming) and revisit the extension      |
| Read status is visible to other participants                | Intended feature; one-time notice (FR-125) and user-guide explanation                                                         |

## 8. Open decisions

1. **Rich-text subset version:** confirm that the TipTap/ProseMirror JSON subset (ADR section 5.4) is acceptable as
   the stored format, since it becomes part of the file contract in phase 1.

## 9. Definition of done (every phase)

- All new code is covered by tests at the appropriate level, and CI is green.
- The CI-built installer installs and runs on a clean Windows machine.
- No new lint boundary violations; no `any` introduced without justification.
- Requirements listed for the phase are demonstrably met; the coverage table in section 5 is updated if scope moved.
- Strings are in Russian and live in the dictionary module.

## 10. Code signing options (for a later release)

**Decision: version 1.0 ships unsigned.** This section is kept for reference in case signing is added later.

A code-signing certificate lets Windows show a verified publisher name for `BranchChat-Setup.exe` instead of "Unknown
publisher". Prices were checked in November 2026 and change often.

| Option                                        | Approximate cost    | Notes                                                                                                                                           |
|-----------------------------------------------|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| Unsigned (chosen for 1.0)                     | 0                   | SmartScreen warning ("More info", then "Run anyway"); document it                                                                               |
| Azure Artifact Signing (Microsoft)            | about $10/month     | Works from GitHub Actions; available to organizations in the EU, UK, US, Canada; individuals only in the US and Canada                          |
| Certificate from a certificate authority (OV) | about $150–300/year | Private key must be on a hardware token or cloud signing service; some resellers sell cloud-based plans for about $110/year on multi-year terms |
| EV certificate                                | $400+/year          | No longer avoids SmartScreen warnings; not recommended for this project                                                                         |

Signing does not make SmartScreen warnings disappear on day one: reputation builds with download volume. The practical
benefits are a verified publisher name, fewer antivirus false positives, and a verifiable update publisher.
