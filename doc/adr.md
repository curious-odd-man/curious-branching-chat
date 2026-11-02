# ADR-001: Desktop technology for BranchChat

**Status:** Proposed. Option D (Electron + TypeScript) is the leading candidate. Final confirmation depends on the
focused spikes in section 11.  
**Decision scope:** Windows 10 and Windows 11 desktop application  
**Previous project:** JavaFX + Spring Boot + Gradle (see section 13 for its disposition)  
**Product constraints:** Offline-first, one portable discussion file, file exchange through WhatsApp, rich-text chat
UI, clipboard images, GitHub Releases updates, simple Windows delivery and file association, local read/unread state.

---

## 1. Summary

BranchChat is a Windows-only desktop application. Other platforms are outside the product scope and do not influence
this decision.

**Proposed decision:** build BranchChat with **Electron + TypeScript**, a **React** UI, and **TipTap (ProseMirror)** as
the rich-text editor. Application logic runs in the Electron main process; there is no separate Node.js service and no
local HTTP server. Package with **electron-builder** as a **per-user NSIS installer** (`BranchChat-Setup.exe`), and
update through **electron-updater** against GitHub Releases.

Why:

- The riskiest feature is selecting text across formatting boundaries and anchoring a stable quote for "Reply to this".
  ProseMirror/TipTap have a mature selection and position model for this; a custom JavaFX editor would need much more
  custom work.
- TypeScript can be used for the UI and for application logic, without introducing Rust (Tauri) or a local server
  (Spring Boot).
- Windows integration (file dialogs, clipboard, drag-and-drop, single-instance handling, opening files passed by
  Windows) is well supported.
- The larger download size and memory use of Electron are acceptable for a chat-style application.

The main trade-off concerns **delivery**. A true portable single `BranchChat.exe` is possible with Electron, but it
works poorly with file association and updates (section 4). One installer `.exe` that the user downloads and runs
satisfies the intent of the "single self-contained EXE" goal more reliably, so the requirements are adjusted to that.

## 2. Decision drivers

| Driver                            | Importance | What to verify                                                                    |
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
| Reuse of existing Java code       | Low        | See section 13                                                                    |

## 3. Options considered

### Option A — JavaFX desktop application

Keep JavaFX as the UI and Java for the application and domain layers.

- **Strengths:** reuses the existing project and knowledge; native desktop lifecycle; jpackage can create Windows
  application images and installers; domain and ZIP code can stay independent of the UI.
- **Weaknesses:** rich-text editing needs the most custom work; jpackage normally produces an application image or
  installer, not a single portable EXE; file association needs an installer or first-run registration; hosting a web
  editor in JavaFX WebView would create a hybrid UI with integration complexity.
- **Verdict:** lowest risk for packaging and Windows integration, highest risk for the central feature (rich-text
  selection and quoting).

### Option B — Web frontend with a local Java/Spring Boot host

React or Vue served by a local Spring Boot process.

- **Strengths:** mature browser editors; Java domain code reusable.
- **Weaknesses:** a localhost server brings port selection, process lifecycle, local API protection, and a
  browser-tab experience that feels less like a Windows application; packaging a JRE, server, and frontend into
  one deliverable is complicated; passing a file path from Windows to the running instance needs explicit work.
- **Verdict:** rejected. It combines the packaging complexity of Java with the security surface of a local server.

### Option C — TypeScript frontend in a Tauri shell

- **Strengths:** small runtime (uses the system WebView); modern web editor ecosystem; produces compact packages.
- **Weaknesses:** requires Rust for the host and native integrations; single-instance, file association, and
  updater behavior depend on plugins that must be validated; two languages to maintain.
- **Verdict:** a credible alternative if footprint becomes important and Rust is acceptable. Not selected because it
  adds a language without addressing a problem this product has.

### Option D — Electron + Node.js + TypeScript (leading candidate)

Electron provides Chromium for rendering and Node.js for the main process, connected through controlled IPC.

- **Strengths:**
    - Nearly everything is written in TypeScript; no Rust, no Java.
    - Mature web editor ecosystem (TipTap/ProseMirror, Lexical).
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

These are judgments for this project, not benchmark results. The scored matrix in the previous version of this
document was removed because its scales were inconsistent and several rows double-counted the same factor.

## 4. Windows delivery

### 4.1 Packaging options for Electron

| Format                             | Single file | File association | Updates                | Notes                                                                                                             |
|------------------------------------|-------------|------------------|------------------------|-------------------------------------------------------------------------------------------------------------------|
| **NSIS installer, per-user**       | Yes (setup) | Yes (installer)  | electron-updater       | **Recommended.** No administrator rights; installs under the user profile                                         |
| Portable `.exe` (electron-builder) | Yes         | No               | Poor / manual          | Self-extracts to a temporary folder on every launch, so startup is slower and antivirus tools are more suspicious |
| Portable folder in a ZIP           | No          | Via app setting  | Manual replacement     | Fallback if installers are unacceptable                                                                           |
| Squirrel.Windows (Forge)           | Yes (setup) | Limited          | Built-in `autoUpdater` | Less flexible installer; not preferred                                                                            |
| MSIX                               | Yes         | Via manifest     | Store / App Installer  | Signing and sideloading friction; dropped from consideration                                                      |

### 4.2 Decision

1. Primary deliverable: **`BranchChat-Setup.exe`**, a per-user NSIS installer built with electron-builder
   (`perMachine: false`). The user downloads one file from the GitHub Release and runs it; no Java, Node.js, or
   browser installation is needed.
2. Optional secondary deliverable: a portable ZIP, for users who cannot run installers.
3. A portable single `BranchChat.exe` is **not** a goal. It remains a spike measurement (S2) so that the decision is
   based on data, not assumption.

### 4.3 Preferred user experience

1. The user downloads `BranchChat-Setup.exe` from the official GitHub Release.
2. The user runs it. The installer offers to associate `.branchchat` files with BranchChat (consent required).
3. After installation, double-clicking a `.branchchat` file in Explorer opens that discussion.
4. If BranchChat is already running, the new file is passed to the existing instance.
5. The association can be removed through application settings or by uninstalling.

`.branchchat` is a new extension, so there is no existing association to take over. The consent requirement
(FR-090) therefore means the installer must ask, not register silently. electron-builder registers `fileAssociations`
automatically, so showing a choice may need a small custom NSIS script; spike S2 verifies this.

### 4.4 Code signing and trust

Neither the previous ADR nor the requirements addressed this. Unsigned installers trigger Windows SmartScreen
warnings and are more likely to be flagged by antivirus tools, which is a serious problem for non-technical users who
receive the application link through WhatsApp. Signed releases also give electron-updater a publisher identity to
verify.

- Decide whether a code-signing certificate (for example a standard certificate or a cloud signing service) is in
  budget.
- If releases remain unsigned, the release notes must explain the SmartScreen warning.
- Spike S2 should compare unsigned and signed behavior on a clean machine.

## 5. Architecture

Keep the discussion model and persistence independent of the presentation layer and of Electron.

### 5.1 Logical modules

- **Presentation:** chat view, branch navigation, composer, formatting controls, unread indicators.
- **Domain:** discussion, participant, message, thread, branching rules, context resolution, validation.
- **Document:** ZIP container, manifest, JSON serialization, schema validation, versioning, migrations, atomic save.
- **Assets:** embedded images, type validation, deduplication, size limits.
- **Local state:** participant settings, read state keyed by `documentId` + `messageId`, update preferences. Stored in
  the user's application data folder, never in the discussion file.
- **Windows integration:** open-file arguments, single-instance handling, file association, clipboard, drag-and-drop,
  external links.
- **Updates:** GitHub Releases lookup, stable-channel filtering, verification, staging.

The domain model must not depend on React, Electron, or any UI API.

### 5.2 Suggested stack

- Electron + TypeScript (strict mode).
- React for the renderer.
- TipTap (ProseMirror) for rich text.
- A schema-validation library (for example zod) for the document and for IPC messages.
- A maintained ZIP library with streaming support and entry-level limits.
- electron-builder (packaging) and electron-updater (updates).

### 5.3 Suggested project structure

```
src/
  main/
    application/      app lifecycle, windows, single-instance handling
    document/         ZIP read/write, atomic save, migrations
    local-state/      settings, participant ID, read state
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
    domain/           discussion, message, participant, branching, context
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
assets/
  images/
  attachments/
```

The document format is a product-level contract and must not depend on the UI framework or packaging technology.

**Rich-text content format.** Messages store structured, versioned content, not HTML. The simplest option is the
TipTap/ProseMirror JSON document. If that is used, it must be defined as a documented subset (the nodes and marks the
product supports: headings 1–3, bullet and ordered lists, bold, italic, underline, text color, background color, link,
image), and `schemaVersion` must change whenever that subset changes. Unknown nodes and marks in a received file are
rejected or shown as plain text, never executed or rendered as HTML.

**Branch anchors.** Messages are immutable, so the selection range stored in a branch (`selectionStart`,
`selectionEnd`, expressed in the message content model) stays valid. The stored `quoteText` and `sourceMessageId`
remain the durable reference; the range is used for highlighting and may be ignored if it no longer matches the quote.

**Message order.** Messages carry a `sequence` number within their thread. Display order follows the sequence, not
timestamps, because computers' clocks can differ.

### 5.5 Conceptual service interfaces

- `DiscussionDocumentRepository`
- `ReadStateStore`
- `ClipboardImageProvider`
- `ExternalLinkOpener`
- `DocumentOpenService`
- `FileAssociationService`
- `ParticipantSettings`
- `UpdateService`

## 6. Rich-text, context, and unread behavior to verify

The rich-text editor is one of the highest-risk parts of the product (spike S1). The spike must verify:

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
- Clipboard image paste and embedding, including size limits and type validation.
- Unread highlighting that works in both the thread and the inherited context.
- A discussion with 5,000 messages stays responsive (virtualized message list).

Do not choose an editor based only on a demo. Test the exact branching interaction.

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

- Validate `manifest.json` and `discussion.json` against the schema before use.
- Never render stored content as raw HTML or evaluate scripts from it; render from the validated structured content.
- Guard the ZIP reader against path traversal (zip-slip), an excessive number of entries, and decompression bombs
  (limit total and per-entry uncompressed size).
- Accept only supported image types (PNG, JPEG, GIF, WebP); do not render SVG in the MVP.
- Open links only for `http`, `https`, and `mailto`, and only after an explicit user action.
- Never automatically fetch remote content.

## 8. File association and multi-instance behavior

For the packaged Windows application, the proof must show that BranchChat can:

1. Register `.branchchat` for the current Windows user, with the user's consent.
2. Unregister the association (application setting and uninstall).
3. Receive a file path when launched by double-clicking a `.branchchat` file (arrives in the process arguments).
4. Validate the path and show a useful error for missing or invalid files (FR-118).
5. Forward a second open request to the running instance (`second-instance` event) and open it in a new window, or
   focus the existing window if that file is already open.
6. Open the document without a network connection.
7. Preserve the association and application settings during an update.

Verify on a clean Windows 10 and Windows 11 environment, not only on the development machine.

Local data (settings, participant ID, read state) lives in the per-user application data folder, so it survives
updates and does not depend on where the executable is located.

## 9. GitHub Releases update strategy

Use **electron-updater** (electron-builder's updater) with the GitHub provider. Electron's built-in `autoUpdater` on
Windows is based on Squirrel.Windows and does not fit an NSIS installer.

Required behavior:

- Stable releases only; draft and prerelease versions ignored (FR-094).
- Background update check and manual **Help > Check for updates**; automatic checks configurable.
- Show version, release date, release notes, and download size.
- Download only the expected Windows artifact.
- Verify the checksum published in the release metadata, and the publisher signature if releases are signed.
  electron-updater publishes SHA-512 checksums in `latest.yml`; requirement FR-101 was changed to "SHA-256 or
  stronger" to match.
- Download in the background; apply when the application restarts, with the application closed during replacement.
- Preserve user settings, read state, and the file association.
- Never touch discussion documents.
- Provide a recovery path: a failed or interrupted update must leave the previous installed version working.
- Work normally when offline; update failure must not block local use.
- The GitHub repository must be public for the updater to read releases without embedding a token in the application.

Spike S3 must test the full cycle, including a deliberately corrupted download and an interrupted update.

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
- Code signing adds cost and process.
- Existing Java code is not reused.

## 11. Spikes and acceptance checklist

The earlier plan of building the same prototype in JavaFX and TypeScript is replaced by four focused spikes on the
leading candidate. A JavaFX prototype is built only if a spike fails and Option D has to be re-examined.

**S1 — Editor and branching (TipTap + React).** Everything in section 6.  
**S2 — Packaging and association.** Build the NSIS per-user installer. Test on clean Windows 10 and 11 virtual
machines: install without administrator rights, consent-based association, double-click, second-instance behavior,
uninstall. Compare signed and unsigned behavior. Measure installer size, startup time, and memory. For comparison
only, build the portable `.exe` and measure its startup.  
**S3 — Updates.** electron-updater against a test GitHub repository: stable-only filtering, checksum verification,
corrupted-download rejection, interrupted update recovery, settings and association preserved.  
**S4 — Document format and safety.** ZIP read/write, atomic save (including power-loss simulation by killing the
process mid-write), schema validation, malicious ZIP and malformed JSON test files, large images, a 5,000-message
document.

Acceptance checklist:

- [ ] Installs and launches on a clean Windows 10/11 machine without installing any runtime or needing administrator
  rights.
- [ ] Single downloadable `.exe` installer produced.
- [ ] `.branchchat` registered with consent and unregistered cleanly.
- [ ] Double-clicking a `.branchchat` file opens the correct discussion.
- [ ] A second file opened while the app runs opens in a new window; the same file opened twice focuses the existing
  window.
- [ ] Works fully offline for create, open, edit, and save.
- [ ] Supports required formatting and nested lists.
- [ ] Text selection across formatting spans is reliable.
- [ ] "Reply to this" creates a branch with the correct quote and context, including from inherited context.
- [ ] Clipboard images are embedded and survive reopening.
- [ ] Unread highlighting, per-branch counts, and "mark as read" work without modifying the discussion file.
- [ ] A 5,000-message discussion remains responsive.
- [ ] Malformed and malicious test files are rejected or displayed safely.
- [ ] Update flow verifies and applies the correct Windows release; a failed update leaves the previous version and
  documents intact.
- [ ] SmartScreen behavior documented for signed and unsigned installers.
- [ ] Installer size, startup time, and memory use measured and judged acceptable.

## 12. Decision record

Fill in the "Confirmed" column after the spikes.

| Decision                            | Proposed                                                         | Confirmed |
|-------------------------------------|------------------------------------------------------------------|-----------|
| Desktop runtime                     | Electron                                                         | TBD       |
| Main application language           | TypeScript                                                       | TBD       |
| UI framework                        | React                                                            | TBD       |
| Rich-text editor                    | TipTap (ProseMirror)                                             | TBD       |
| Node.js backend                     | Electron main process only; no separate service                  | TBD       |
| Windows packaging tool              | electron-builder                                                 | TBD       |
| Windows packaging format            | Per-user NSIS installer (`BranchChat-Setup.exe`)                 | TBD       |
| Single-EXE feasibility              | Single installer: yes. Portable single EXE: not a goal           | TBD       |
| `.branchchat` association mechanism | Installer registration with consent; app setting to remove       | TBD       |
| Multi-instance / open-file behavior | Single instance lock; one window per document                    | TBD       |
| Rich-text storage format            | Versioned structured JSON (TipTap/ProseMirror subset)            | TBD       |
| Document schema and ZIP layout      | ZIP + JSON (`manifest.json`, `discussion.json`, `assets/`)       | TBD       |
| Read state storage                  | Local application data, keyed by documentId + messageId          | TBD       |
| Update mechanism                    | electron-updater, GitHub Releases, stable only                   | TBD       |
| Code signing                        | Signed releases if budget allows; document SmartScreen otherwise | TBD       |
| Keep or remove Spring Boot          | Remove                                                           | TBD       |

## 13. Disposition of the existing JavaFX project

Option D reuses no Java code. Do not keep Spring Boot "just because it exists".

- Archive the JavaFX/Spring Boot/Gradle project in a separate branch or repository tag.
- Carry over the knowledge, not the code: the domain concepts, the ZIP layout, and any sample `.branchchat` files as
  test fixtures for the TypeScript implementation.
- If any real discussion files already exist in a Java-written format, define a migration or ensure the TypeScript
  reader accepts them.

## 14. References

JavaFX and Java packaging

- JavaFX: https://openjfx.io/
- Java jpackage: https://docs.oracle.com/en/java/javase/21/jpackage/

Tauri

- Tauri documentation: https://v2.tauri.app/
- Tauri architecture: https://v2.tauri.app/concept/architecture/

Electron and Node.js

- Electron documentation: https://www.electronjs.org/docs/latest/
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron single instance lock: https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelock
- electron-builder: https://www.electron.build/
- electron-updater (auto update): https://www.electron.build/auto-update
- Electron autoUpdater (Squirrel-based): https://www.electronjs.org/docs/latest/api/auto-updater

Rich-text editors

- TipTap: https://tiptap.dev/
- ProseMirror: https://prosemirror.net/
- Lexical: https://lexical.dev/

## Changes in this revision

- Status changed from open options analysis to a proposed decision for Option D, with spikes replacing the dual
  JavaFX/TypeScript prototype plan.
- Delivery changed from "portable single EXE preferred" to a per-user NSIS installer; the portable EXE and MSIX
  options are evaluated and set aside.
- Corrected the updater: electron-updater, not Electron's built-in Squirrel-based `autoUpdater`; noted the SHA-512
  vs SHA-256 difference.
- Added sections on code signing, untrusted documents, rich-text storage format, message ordering, and local read
  state.
- Replaced the numeric score table with a qualitative comparison.
- Fixed the project structure and moved the shared domain code to `shared/`.
- Filled the decision record with proposed values and added the disposition of the existing JavaFX project.
