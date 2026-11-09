# ADR-001: Desktop technology for BranchChat

**Status:** Accepted — Option D (Electron + TypeScript)  
**Decision scope:** Windows 10 and Windows 11 desktop application  
**Previous project:** JavaFX + Spring Boot + Gradle (archived; see section 12)  
**Product constraints:** Offline-first, one portable discussion file, file exchange through WhatsApp, rich-text chat
UI, clipboard images, GitHub Releases updates, simple Windows delivery and file association, read state stored in the
file.

---

## 1. Decision

BranchChat is built with **Electron + TypeScript**, a **React** UI, and **TipTap (ProseMirror)** as the rich-text
editor. Application logic runs in the Electron main process; there is no separate Node.js service and no local HTTP
server. The application is packaged with **electron-builder** as a **per-user NSIS installer**
(`BranchChat-Setup.exe`), and updates through **electron-updater** against GitHub Releases. Spring Boot and JavaFX are
removed.

Why:

- The riskiest feature is selecting text across formatting boundaries and anchoring a stable quote for "Reply to this".
  ProseMirror/TipTap have a mature selection and position model for this; a custom JavaFX editor would need much more
  custom work.
- TypeScript is used for the UI and for application logic, without introducing Rust (Tauri) or a local server
  (Spring Boot).
- Windows integration (file dialogs, clipboard, drag-and-drop, single-instance handling, opening files passed by
  Windows) is well supported.
- The larger download size and memory use of Electron are acceptable for a chat-style application.

**Delivery trade-off.** A portable single `BranchChat.exe` is possible with Electron, but it works poorly with file
association and updates (section 4). One installer `.exe` that the user downloads and runs satisfies the intent of the
"single self-contained EXE" goal more reliably, so the requirements specify that.

## 2. Decision drivers

| Driver                            | Importance | Question                                                                          |
|-----------------------------------|------------|-----------------------------------------------------------------------------------|
| Simple Windows delivery           | Critical   | Can the user get one file and run it without installing any runtime?              |
| Windows file association          | Critical   | Can `.branchchat` be registered, removed, and passed to the app reliably?         |
| Offline operation                 | Critical   | Do opening, editing, and saving work without a network connection?                |
| Rich-text selection and branching | Critical   | Can a selection span formatting boundaries and keep a stable quote?               |
| Safe handling of received files   | Critical   | Can a malformed or malicious `.branchchat` be rejected or displayed safely?       |
| Clipboard images                  | High       | Can images be pasted and embedded in the discussion file?                         |
| Native Windows experience         | High       | File dialogs, drag-and-drop, DPI, shortcuts, multi-window behavior                |
| GitHub Releases updates           | High       | Can updates be checked, verified, staged, and applied without damaging documents? |
| Trust on download (signing)       | High       | Do SmartScreen and antivirus tools accept the installer and updater?              |
| Maintenance burden                | High       | How many languages, runtimes, packaging systems, and update mechanisms?           |
| TypeScript development            | Medium     | Can most application logic be written in TypeScript?                              |
| Application footprint             | Medium     | Installer size, startup time, memory use                                          |
| Reuse of existing Java code       | Low        | See section 12                                                                    |

## 3. Options considered

### Option A — JavaFX desktop application

- **Strengths:** reuses the existing project and knowledge; native desktop lifecycle; jpackage can create Windows
  application images and installers.
- **Weaknesses:** rich-text editing needs the most custom work; jpackage normally produces an application image or
  installer, not a single portable EXE; hosting a web editor in JavaFX WebView would create a hybrid UI.
- **Verdict:** lowest packaging risk, highest risk for the central feature. Not selected.

### Option B — Web frontend with a local Java/Spring Boot host

- **Strengths:** mature browser editors; Java domain code reusable.
- **Weaknesses:** a localhost server brings port selection, process lifecycle, local API protection, and a
  browser-tab experience that feels less like a Windows application; packaging a JRE, server, and frontend together
  is complicated.
- **Verdict:** rejected. It combines the packaging complexity of Java with the security surface of a local server.

### Option C — TypeScript frontend in a Tauri shell

- **Strengths:** small runtime (uses the system WebView); modern web editor ecosystem.
- **Weaknesses:** requires Rust for the host and native integrations; single-instance, file association, and updater
  behavior depend on plugins; two languages to maintain.
- **Verdict:** credible, but adds a language without addressing a problem this product has. Not selected.

### Option D — Electron + Node.js + TypeScript (selected)

Electron provides Chromium for rendering and Node.js for the main process, connected through controlled IPC.

- **Strengths:**
    - Nearly everything is written in TypeScript; no Rust, no Java.
    - Mature web editor ecosystem (TipTap/ProseMirror).
    - Main-process access to the filesystem for ZIP handling and atomic saves, without Spring Boot.
    - `app.requestSingleInstanceLock()` and the `second-instance` event provide a standard way to pass an opened file to
      the running instance.
    - Established packaging (electron-builder) and updater (electron-updater) with a GitHub Releases provider.
- **Weaknesses:**
    - Larger installer and higher memory use than Tauri or JavaFX.
    - Security-sensitive process model; needs strict configuration (section 7).
    - The Electron/Chromium runtime must be kept up to date.
    - The portable single-EXE target is a poor fit for association and updates (section 4).

### Qualitative comparison

| Criterion                       | A: JavaFX       | B: Spring Boot + web | C: Tauri          | D: Electron                 |
|---------------------------------|-----------------|----------------------|-------------------|-----------------------------|
| Rich-text selection and quoting | Weak (custom)   | Strong               | Strong            | Strong                      |
| Languages to maintain           | Java            | Java + TypeScript    | Rust + TypeScript | TypeScript                  |
| Windows installer + association | Good (jpackage) | Hard                 | Good (bundler)    | Good (NSIS)                 |
| Updates from GitHub Releases    | Must be built   | Must be built        | Built-in, verify  | Built-in (electron-updater) |
| Local server needed             | No              | Yes                  | No                | No                          |
| Footprint                       | Medium          | Medium               | Small             | Large                       |
| Reuse of existing project       | High            | High                 | Low               | Low                         |

These are judgments for this project, not benchmark results.

## 4. Windows delivery

### 4.1 Packaging options for Electron

| Format                             | Single file | File association | Updates                | Notes                                                                                                             |
|------------------------------------|-------------|------------------|------------------------|-------------------------------------------------------------------------------------------------------------------|
| **NSIS installer, per-user**       | Yes (setup) | Yes (installer)  | electron-updater       | **Selected.** No administrator rights; installs under the user profile                                            |
| Portable `.exe` (electron-builder) | Yes         | No               | Poor / manual          | Self-extracts to a temporary folder on every launch, so startup is slower and antivirus tools are more suspicious |
| Portable folder in a ZIP           | No          | Via app setting  | Manual replacement     | Fallback if installers prove unacceptable                                                                         |
| Squirrel.Windows (Forge)           | Yes (setup) | Limited          | Built-in `autoUpdater` | Less flexible installer; not preferred                                                                            |
| MSIX                               | Yes         | Via manifest     | Store / App Installer  | Signing and sideloading friction; dropped                                                                         |

### 4.2 Decision

1. Primary deliverable: **`BranchChat-Setup.exe`**, a per-user NSIS installer built with electron-builder
   (`perMachine: false`). The user downloads one file from the GitHub Release and runs it; no Java, Node.js, or
   browser installation is needed.
2. A portable single `BranchChat.exe` is not a goal.
3. A portable ZIP may be added later as an optional extra if users ask for it.

### 4.3 User experience

1. The user downloads `BranchChat-Setup.exe` from the official GitHub Release.
2. The user runs it. The installer offers to associate `.branchchat` files with BranchChat (consent required).
3. After installation, double-clicking a `.branchchat` file in Explorer opens that discussion.
4. If BranchChat is already running, the new file is passed to the existing instance.
5. The association can be removed through application settings or by uninstalling.

`.branchchat` is a new extension, so there is no existing association to take over. The consent requirement (FR-090)
therefore means that nothing is registered without the person's choice, and that a type held by another program is
never taken over.

**Decision (implemented in phase 7).** electron-builder's `fileAssociations` is deliberately not used, because it
registers the type automatically. Instead:

- `build/installer.nsh` adds a "Файлы обсуждений" page (after the welcome page) with a checkbox, ticked by default, and
  registers the type for the current user (HKCU) only if it is ticked and no other program holds the type. Silent
  installs and updates (`/S`, `--updated`) never show the page and never change the association. The uninstaller removes
  it unless it is running as part of an update. The installer script was compiled with makensis (warnings as errors) in
  the Linux sandbox; its behavior on Windows is checked by `scripts/installer-smoke.ps1` (CI) and the checklist in
  `docs/windows-test-checklist.md`.
- The application can also register or remove the association (Settings), and asks once on first start if neither the
  installer nor the person has decided (fallback for builds not made with the installer). It writes the same HKCU keys
  through `reg.exe` (no native module) and treats a type held by another program, or a "UserChoice" for another
  program, as "do not touch".
- The document icon ships as `resources\document.ico` (`extraResources`); the app and installer icon is
  `build/icon.ico`. Both are generated by `scripts/make-icons.mjs` and committed.

### 4.4 Code signing and trust

Unsigned installers show Windows SmartScreen warnings and are more likely to be flagged by antivirus tools. Signing
shows a verified publisher name instead of "Unknown publisher" and gives electron-updater a publisher identity to
verify. Since 2024, signing does not remove SmartScreen warnings for new files immediately, whatever certificate type
is used; the warnings fade as downloads accumulate.

- **Decision: releases are unsigned in the MVP.** The product works the same unsigned.
- The release notes, README, and user guide must explain the SmartScreen warning ("More info", then "Run anyway"),
  state that the installer comes only from the official GitHub Release, and publish its SHA-256 checksum.
- Updates work unsigned: electron-updater verifies the checksum from the release metadata over HTTPS. That protects
  against corrupted downloads, but both the installer and the checksum come from the same GitHub release, so the
  GitHub account and repository are the trust anchor. Protect them: two-factor authentication, restricted write
  access, and releases built only by the CI workflow.
- Signing can be added in any later release by changing the build configuration only. Options and costs are in the
  implementation plan.

## 5. Architecture

Keep the discussion model and persistence independent of the presentation layer and of Electron.

### 5.1 Logical modules

- **Presentation:** chat view, branch navigation, composer, formatting controls, unread indicators.
- **Domain:** discussion, participant, message, thread, branching rules, context resolution, read-state rules.
- **Document:** ZIP container, manifest, JSON serialization, schema validation, versioning, migrations, atomic save.
- **Assets:** embedded images, type validation, deduplication by content hash.
- **Local state:** participant settings (name, ID) and update preferences, stored in the user's application data
  folder.
- **Windows integration:** open-file arguments, single-instance handling, file association, clipboard, drag-and-drop,
  external links.
- **Updates:** GitHub Releases lookup, stable-channel filtering, verification, staging.

The domain model must not depend on React, Electron, or any UI API.

### 5.2 Stack

- Electron + TypeScript (strict mode).
- React for the renderer.
- TipTap (ProseMirror) for rich text.
- A schema-validation library (for example zod) for the document and for IPC messages.
- A maintained ZIP library with streaming support.
- electron-builder (packaging) and electron-updater (updates).

### 5.3 Project structure

```
src/
  main/
    application/      app lifecycle, windows, single-instance handling
    document/         ZIP read/write, atomic save, migrations
    local-state/      participant settings, update preferences
    windows/          file association, open-file handling
    updates/          release lookup, verification, staging
    ipc/              validated IPC handlers
  preload/            contextBridge API (narrow, typed)
  renderer/
    components/
      chat/
      branches/
      editor/
  shared/
    domain/           discussion, message, participant, branching, context, read state
    types/
    validation/       schemas used by main and renderer
```

`shared/domain` and `shared/validation` have no dependency on Electron or React, so they can be unit-tested in plain
Node.

### 5.4 Document format

One self-contained file per discussion, for example `discussion.branchchat`, a ZIP container:

```
manifest.json
discussion.json
readstate.json
assets/
  images/
  attachments/
```

The document format is a product-level contract and must not depend on the UI framework or packaging technology.

**Rich-text content format.** Messages store structured, versioned content, not HTML. The simplest option is the
TipTap/ProseMirror JSON document, defined as a documented subset (headings 1–3, bullet and ordered lists, bold,
italic, underline, text color, background color, link, image). `schemaVersion` must change whenever that subset
changes. Unknown nodes and marks in a received file are rejected or shown as plain text, never executed or rendered as
HTML.

**Branch anchors.** Messages are immutable, so the selection range stored in a branch (`selectionStart`,
`selectionEnd`) stays valid. It is expressed as offsets in the message's plain text, defined once in
`linearize()` (`src/shared/validation/richText.ts`): text nodes concatenated, a hard break is one newline, each
paragraph or heading is followed by one newline. Every rendered piece of text carries its own offset
(`<span data-o="N">`), which is how a selection in the page is converted back to stored offsets, including across
bold, italic, link, list-item and paragraph boundaries. The main process derives the quote from the stored message
and validates the range. The stored `quoteText` and `sourceMessageId`
remain the durable reference; the range is used for highlighting and may be ignored if it no longer matches the quote.

**Message order.** Messages carry a `sequence` number within their thread. Display order follows the sequence, not
timestamps, because computers' clocks can differ.

**Read state.** `readstate.json` maps each participant ID to the list of message IDs that participant has read.

- Messages are the immutable core of the document; read state is the only part that changes without a new message,
  so it lives in its own ZIP entry.
- The application writes only the local participant's entry and preserves all other entries unchanged.
- A message becomes read for the local participant by an explicit action, when the participant sends a message in the
  same thread (all earlier messages in that thread), or when the participant creates a branch from it.
- Own messages are implicitly read and are not listed.
- Marking read therefore modifies the file and goes through the same autosave path as every other change.
- Consequence: other participants' copies of the application can see what a participant has read, and the MVP
  displays it on every message (FR-122 to FR-124). Users are told once that their read status is visible (FR-125).
- "Who has read message M" is a domain query over `readstate.json`: all known participants except the author whose
  entry contains M. A person who has never written to the file has no entry and is not shown.

**Saving.** Every change is saved immediately (autosave). Writes go to a temporary file in the same folder and then
replace the original (atomic replace, with retries because Windows antivirus or sync tools can briefly lock files).
The application does not keep the discussion file open between writes, so Explorer and WhatsApp can copy it at any
time. Unchanged ZIP entries (especially large images) are copied through without recompression so that frequent
saves stay cheap even for large files.

**Images.** Images are added through the main process, never as files or URLs chosen by the page:

- Paste, drop and "Insert image…" send the bytes (or a chosen file) to the main process, which accepts only PNG, JPEG,
  GIF and WebP by looking at the first bytes (SVG is refused), computes the SHA-256, and keeps the image in memory as
  part of the draft. There is no size limit.
- When a message that uses the image is sent, the image is registered in `discussion.json` (its id is its SHA-256) and
  written to `assets/images/<sha256>.<ext>` by the next save. An image that is never sent is never written.
- The window shows images through the app's own `bcasset:` scheme: `bcasset://asset/<sessionId>/<assetId>`. The main
  process answers only for discussions that are open (the session id is random per window), checks the recorded type
  and checksum before returning anything, sends the response as an image with `nosniff`, and answers 404 for missing or
  damaged data, which the window shows as a placeholder. The content security policy allows `img-src bcasset:` and
  nothing remote.
- A pasted HTML `<img>` cannot create an image in the editor unless it carries the id of an image this app rendered,
  and an id that was never added to the draft is refused when the message is sent.
- Images are stored uncompressed in the ZIP and copied through unchanged when only the JSON changes, so saving a
  message in a discussion with large images stays fast.

### 5.5 Conceptual service interfaces

- `DiscussionDocumentRepository`
- `ReadStateService` (domain rules over `readstate.json`)
- `ClipboardImageProvider`
- `ExternalLinkOpener`
- `DocumentOpenService`
- `FileAssociationService`
- `ParticipantSettings`
- `UpdateService`

## 6. Behavior to implement and test

The rich-text editor is the highest-risk part of the product, so these behaviors are implemented and tested early (see
the implementation plan):

- Heading levels 1–3.
- Bold, italic, underline, text color, and background color.
- Nested bullet and numbered lists.
- Links and embedded images.
- Selecting text across multiple formatting spans, lists, and links.
- A reliable "Reply to this" action for the selected range, including inside read-only inherited context.
- A stable stored quote and source-message reference.
- Inherited context: parent-thread messages up to and including the source message, recursively; later parent messages
  and sibling branches excluded.
- Persistence and restoration after closing and reopening.
- Clipboard image paste and embedding.
- Unread highlighting in both the thread and the inherited context, with read-on-reply rules.
- Thousands of messages stay responsive (virtualized message list).

There are no artificial limits on message count, message length, branch depth, image size, or file size (NFR-015).

## 7. Security

### 7.1 Electron process model

- Keep `nodeIntegration` disabled in renderer processes.
- Enable `contextIsolation` and use sandboxed renderers.
- Use preload scripts and `contextBridge` to expose a narrow, typed API.
- Validate every IPC request (schema) and every filesystem path.
- Do not let the renderer access the filesystem directly. Document parsing and file operations run in the main process
  or a controlled utility process.
- Apply a strict Content Security Policy; no remote code, no remote content.
- Deny in-app navigation and new window creation except to explicitly opened external links.

### 7.2 Received discussion files are untrusted

A `.branchchat` file arrives through WhatsApp from outside the application, so it must be treated as untrusted input.

- Validate `manifest.json`, `discussion.json`, and `readstate.json` against the schema before use.
- Never render stored content as raw HTML or evaluate scripts from it; render from the validated structured content.
- Guard the ZIP reader against path traversal (zip-slip). Read entries as streams and reject entries whose actual
  size differs from the declared size. This protects against malformed archives without imposing a product limit on
  file size.
- Accept only supported image types (PNG, JPEG, GIF, WebP); do not render SVG in the MVP.
- Open links only for `http`, `https`, and `mailto`, and only after an explicit user action.
- Never automatically fetch remote content.

## 8. File association and multi-instance behavior

For the packaged Windows application:

1. Register `.branchchat` for the current Windows user, with the user's consent (installer option; application
   setting).
2. Unregister the association (application setting and uninstall).
3. Receive a file path when launched by double-clicking a `.branchchat` file (arrives in the process arguments).
4. Validate the path and show a useful error for missing or invalid files (FR-118).
5. Forward a second open request to the running instance (`second-instance` event) and open it in a new window, or
   focus the existing window if that file is already open.
6. Open the document without a network connection.
7. Preserve the association and application settings during an update.

Local data (settings, participant ID) lives in the per-user application data folder, so it survives updates and does
not depend on where the executable is located.

## 9. GitHub Releases update strategy

Use **electron-updater** (electron-builder's updater) with the GitHub provider. Electron's built-in `autoUpdater` on
Windows is based on Squirrel.Windows and does not fit an NSIS installer.

Required behavior:

- Stable releases only; draft and prerelease versions ignored (FR-094).
- Background update check and manual **Help > Check for updates**; automatic checks configurable.
- Show version, release date, release notes, and download size.
- Download only the expected Windows artifact.
- Verify the checksum published in the release metadata (and the publisher signature if signing is added later).
  electron-updater publishes SHA-512 checksums in `latest.yml`; requirement FR-101 says "SHA-256 or stronger" to match.
- Download in the background; apply when the application restarts, with the application closed during replacement.
- Preserve user settings and the file association.
- Never touch discussion documents.
- A failed or interrupted update must leave the previous installed version working.
- Work normally when offline; update failure must not block local use.
- The GitHub repository must be public for the updater to read releases without embedding a token in the application.

**Decision (implemented in phase 8).**

- electron-updater's `NsisUpdater` with the GitHub provider; `autoDownload` is off, prereleases and downgrades are
  refused, `autoInstallOnAppQuit` is on, and no request headers are added (so a request is the plain metadata and file
  download, NFR-008). The owner and repository come from the `publish` section in `electron-builder.yml`, which
  electron-builder writes into the installed application as `app-update.yml`.
- A check runs 20 seconds after start and every 6 hours, unless switched off in Settings; Help > Check for updates
  always works. Nothing is downloaded until the person agrees. A downloaded update installs on "Перезапустить и
  установить" or silently when the application is next closed (`/S --updated`, which the installer script already
  treats as "keep the association").
- The checksum check is electron-updater's: the SHA-512 in `latest.yml` is compared with the downloaded file and a
  mismatch is an error, so nothing is installed (FR-102). This is tested end to end against a local feed with a
  corrupted file.
- The service sits behind a small `UpdaterPort` interface, so the flow (states, errors, banner rules) is unit-tested
  with a fake updater, and the real updater is exercised in end-to-end tests that use a local feed in test builds.
- Not verifiable on Linux: running the downloaded installer, and replacing a running program on Windows. The checklist
  in `docs/windows-test-checklist.md` (section H) covers these against a private test repository.

## 10. Consequences

**Positive**

- One language (TypeScript) across UI, domain, and application logic.
- No local server and no Spring Boot.
- A well-supported editor stack for the core feature.
- A conventional installer that handles file association, uninstall, and updates.

**Negative**

- Larger download (typically on the order of 80–100 MB) and higher memory use than a native or Tauri application.
- The team must keep Electron and Chromium updated for security fixes, and ship updates accordingly.
- Strict security configuration is required and must be reviewed.
- Unsigned installers show a SmartScreen warning and may trigger antivirus false positives; this is documented for
  users.
- Existing Java code is not reused.
- Read state in the file means every "mark as read" rewrites the file, and participants' read activity is visible to
  other participants. This is intended (read status is shown on messages) and disclosed to users.
- Read information is only as current as the last file exchange; it is not live.

## 11. Decision record

| Decision                            | Choice                                                                                         |
|-------------------------------------|------------------------------------------------------------------------------------------------|
| Desktop runtime                     | Electron                                                                                       |
| Main application language           | TypeScript                                                                                     |
| UI framework                        | React                                                                                          |
| Rich-text editor                    | TipTap (ProseMirror)                                                                           |
| Node.js backend                     | Electron main process only; no separate service                                                |
| Windows packaging tool              | electron-builder                                                                               |
| Windows packaging format            | Per-user NSIS installer (`BranchChat-Setup.exe`)                                               |
| Single-EXE feasibility              | Single installer: yes. Portable single EXE: not a goal                                         |
| `.branchchat` association mechanism | Installer option with consent (custom NSIS script); application setting to register/unregister |
| Multi-instance / open-file behavior | Single-instance lock; one window per document                                                  |
| Rich-text storage format            | Versioned structured JSON (TipTap/ProseMirror subset)                                          |
| Document schema and ZIP layout      | ZIP + JSON (`manifest.json`, `discussion.json`, `readstate.json`, `assets/`)                   |
| Read state storage                  | In the file, `readstate.json`, per participant                                                 |
| Saving                              | Automatic, atomic replace; no manual Save, no Save As                                          |
| Update mechanism                    | electron-updater, GitHub Releases, stable only                                                 |
| Code signing                        | Not in the MVP; SmartScreen warning documented; may be added later                             |
| Keep or remove Spring Boot / JavaFX | Remove                                                                                         |

## 12. Disposition of the existing JavaFX project

Option D reuses no Java code. Do not keep Spring Boot "just because it exists".

- Archive the JavaFX/Spring Boot/Gradle project in a separate branch or repository tag.
- Carry over the knowledge, not the code: the domain concepts, the ZIP layout, and any sample `.branchchat` files as
  test fixtures for the TypeScript implementation.
- If any real discussion files already exist in a Java-written format, define a migration or ensure the TypeScript
  reader accepts them.

## 13. References

Electron and Node.js

- Electron documentation: https://www.electronjs.org/docs/latest/
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron single instance lock: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock
- electron-builder: https://www.electron.build/
- electron-updater (auto update): https://www.electron.build/auto-update
- Electron autoUpdater (Squirrel-based, not used): https://www.electronjs.org/docs/latest/api/auto-updater

Rich-text editors

- TipTap: https://tiptap.dev/
- ProseMirror: https://prosemirror.net/

Alternatives considered

- JavaFX: https://openjfx.io/
- Java jpackage: https://docs.oracle.com/en/java/javase/21/jpackage/
- Tauri: https://v2.tauri.app/

## Changes in revision 9

- Section 9 now records the implemented update behavior and how it was tested.

## Changes in revision 8

- Section 4.3 now records the implemented decision for the file association (installer page, in-app question, Settings).

## Changes in revision 7

- Documented how images are added, stored and shown (section 5.4).

## Changes in revision 5

- Branch anchors are defined precisely as plain-text offsets (section 5.4).

## Changes in revision 4

- Read status of other participants is now displayed (consequence and domain query documented).
- Code signing decided: unsigned in the MVP. Section 4.4 and the decision record updated; GitHub account protection
  added as the trust anchor for updates.
