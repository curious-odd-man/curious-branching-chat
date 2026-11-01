# BranchChat — Architecture and Technology Decision Record

**Status:** Windows-only options analysis and provisional recommendation  
**Decision scope:** Windows 10 and Windows 11 desktop application  
**Existing project:** JavaFX + Spring Boot + Gradle  
**Product constraints:** Offline-first, one portable discussion file, WhatsApp file exchange, rich-text chat UI,
clipboard images, GitHub Releases updates, simple Windows delivery and file association

---

## 1. Executive summary

BranchChat is a Windows desktop application. Other platforms are outside the product scope and should not influence the
technology choice.

The architecture decision should be driven by the Windows user experience and deployment:

- Prefer a **single self-contained `.exe`** that a user can launch directly.
- Avoid requiring users to install Java, a browser, a local server, or other runtime dependencies.
- Register a discussion file extension (proposed: `.branchchat`) so double-clicking a document in Windows Explorer opens
  it in BranchChat.
- If a single executable is impractical, choose the simplest self-contained Windows package and explain the trade-off.

Three practical options deserve evaluation:

1. **JavaFX desktop application** — lowest disruption to the existing project and a natural fit for Windows file
   operations.
2. **Web UI hosted by a local Java service** — allows modern web editor components while retaining Java domain/document
   code, but needs careful packaging and local-server handling.
3. **Web UI in a desktop shell such as Tauri or Electron** — modern frontend and desktop integration, but introduces a
   new runtime/toolchain and packaging considerations.

Provisional recommendation: do not choose a framework based on hypothetical cross-platform reuse. Build a small
deployment and rich-text proof of concept for JavaFX and one web-based option. Test the actual executable,
file-association, offline, update, and branching workflows before deciding.

## 2. Decision drivers

| Driver                              | Importance | What to verify                                                                       |
|-------------------------------------|-----------:|--------------------------------------------------------------------------------------|
| Single-file or very simple delivery |   Critical | Can the user receive and run one `.exe` without installing a runtime?                |
| Windows file association            |   Critical | Can `.branchchat` be registered, removed, and passed to the app reliably?            |
| Offline operation                   |   Critical | Does opening, editing, and saving work with no network?                              |
| Rich-text selection and branching   |   Critical | Can selection span formatting boundaries and retain a stable quote?                  |
| Clipboard images                    |       High | Can images be pasted and embedded in the discussion file?                            |
| Native Windows experience           |       High | File dialogs, drag-and-drop, DPI, keyboard shortcuts, multi-window behavior          |
| GitHub Releases updates             |       High | Can updates be checked, verified, staged, and applied without damaging documents?    |
| Existing Java code reuse            |     Medium | How much of the current JavaFX/Spring Boot/Gradle project remains useful?            |
| Maintenance burden                  |       High | How many languages, runtimes, packaging systems, and update mechanisms are required? |

## 3. Technology options

### Option A — JavaFX desktop application

Keep JavaFX as the primary UI and retain Java for the application and domain layers.

**Advantages**

- Reuses the existing project and team knowledge.
- Native desktop application lifecycle and straightforward access to Windows file dialogs, clipboard, drag-and-drop, and
  file associations.
- Java domain and ZIP-document code can remain independent of the UI.
- `jpackage` can create Windows application images and installers; a custom packaging step can be investigated for a
  single-executable experience.

**Risks and limitations**

- Rich-text editing may require more custom work than a browser-based editor.
- A true single-file executable is not guaranteed: Java runtime packaging and native launchers commonly produce a
  package or application image rather than one self-contained `.exe`.
- File association registration may be handled by an installer or a first-run registration flow; a portable executable
  cannot assume it has permission to change system-wide associations.
- JavaFX WebView can host a web editor, but that creates a hybrid UI with JavaFX/web integration complexity.

**Best fit when**

- Reusing the existing Java project and native Windows behavior matter more than adopting a browser-based editor.
- The rich-text proof of concept meets selection, formatting, and image requirements.
- A self-contained package is acceptable if a single `.exe` proves impractical.

### Option B — Web frontend with a local Java/Spring Boot host

Build the UI with React, Vue, or another web framework and have a local Java process serve it and expose application
services.

**Advantages**

- Access to mature browser-based rich-text editors and selection APIs.
- Existing Java domain and ZIP-document code can be reused.
- UI and domain/document layers can be separated cleanly.

**Risks and limitations**

- Opening a browser tab at `localhost` may feel less like a conventional Windows desktop application.
- A local server introduces port selection, process lifecycle, browser security, and local API protection requirements.
- Packaging a Java runtime, browser experience, and startup flow into one `.exe` is not straightforward.
- File associations and passing the opened document path from Windows to the running local app need explicit
  implementation.
- Users should not be asked to start Spring Boot manually.

**Best fit when**

- The rich-text editor is decisive and a browser-hosted experience is acceptable.
- The team wants to preserve Java services and is willing to invest in desktop packaging and process management.

**Security requirements if selected**

- Bind only to `127.0.0.1`, never all network interfaces.
- Use a per-launch secret/token for local API requests.
- Restrict allowed origins and validate every request.
- Do not expose arbitrary filesystem access through the local API.
- Shut down the local service cleanly when the application exits.

### Option C — Web frontend in a desktop shell (Tauri or Electron)

Use a web frontend for chat and rich-text UI, packaged as a Windows desktop application through a desktop shell.

**Advantages**

- Strong ecosystem for rich-text editors and text selection.
- A desktop shell can provide file dialogs, filesystem access, clipboard integration, deep links/file-open handling, and
  native menus.
- Can provide a more app-like experience than opening a regular browser tab.

**Risks and limitations**

- Adds another toolchain and runtime model. Tauri introduces Rust; Electron bundles a substantial runtime.
- The existing Spring Boot layer may become unnecessary or may require a separate process, increasing package size and
  complexity.
- The single-`.exe` goal must be tested rather than assumed. A practical output may be an installer or a folder/package
  with supporting files.
- File association registration, launch arguments, second-instance behavior, and update installation need explicit
  implementation.
- Built-in updater workflows may not match a portable single-executable release model without adaptation.

**Best fit when**

- A web-based editor materially improves the core interaction.
- The team accepts a new desktop packaging/toolchain.
- The proof of concept demonstrates a simple Windows release and reliable file association.

### Directional comparison

Scores are relative estimates for this project, not benchmark results. Higher is better.

| Criterion                     | JavaFX | Local web + Spring Boot | Tauri | Electron |
|-------------------------------|-------:|------------------------:|------:|---------:|
| Reuse of current Java project |      5 |                       5 |     2 |        2 |
| Rich-text editor ecosystem    |      3 |                       5 |     5 |        5 |
| Windows-native integration    |      5 |                       3 |     4 |        4 |
| Offline operation             |      5 |                       5 |     5 |        5 |
| Single-EXE potential          |      3 |                       2 |     3 |        2 |
| File association integration  |      4 |                       3 |     4 |        4 |
| Simplicity with current stack |      5 |                       3 |     2 |        2 |
| Runtime/package footprint     |      4 |                       3 |     5 |        2 |

The single-EXE scores are cautious estimates. Each candidate must be tested with an actual packaged build, not judged
from development-mode behavior.

## 4. Windows delivery requirements

### Preferred user experience

1. The user downloads `BranchChat.exe` from the official GitHub Release.
2. The user launches it without installing Java or another runtime.
3. On first launch, BranchChat offers to associate `.branchchat` files with the application.
4. After association, double-clicking a `.branchchat` file in Explorer opens that discussion in BranchChat.
5. If the application is already running, opening another file should pass the document path to the existing instance
   where practical.
6. The user can remove the association through application settings or a clearly documented Windows flow.

### Packaging fallback order

If a single executable is not feasible, evaluate these alternatives in order:

1. A self-contained portable folder distributed as a ZIP.
2. A conventional Windows installer that bundles required runtimes and registers file associations.
3. A more complex package only if it provides a clear user benefit.

Do not require users to install a JRE, configure environment variables, start a server, or manually manage technical
dependencies.

### Portable versus registered

A portable executable can run without installation, but Windows file association normally requires writing a
registration to the user's Windows settings or using an installer/registration helper. Therefore, portability and
double-click opening are compatible only if BranchChat provides an explicit association-registration step and handles
Windows permissions correctly.

Do not silently take over an existing file association. Explain the action and provide a way to undo it.

## 5. Application architecture

Regardless of UI framework, keep the discussion model and document persistence independent of the presentation layer.

Suggested logical modules:

- **Presentation:** chat view, branch navigation, composer, formatting controls.
- **Domain:** discussion, participant, message, thread, branch rules, validation.
- **Document:** ZIP container, manifest, JSON serialization, schema versioning, migrations, atomic save.
- **Assets:** embedded images and other document resources.
- **Windows integration:** open-file arguments, file association, clipboard, drag-and-drop, external links.
- **Updates:** GitHub Releases lookup, stable-channel filtering, checksum verification, staging and replacement.
- **Application services:** autosave, settings, participant identity, error handling.

Avoid making the domain model depend on JavaFX, Spring Boot, React, Tauri, or Electron APIs.

### Discussion file format

Keep one self-contained file per discussion, for example `discussion.branchchat`, implemented as a ZIP container
containing:

    manifest.json
    discussion.json
    assets/
      images/
      attachments/

The document format is a product-level contract. It should not depend on the UI framework or packaging technology.

### Suggested service interfaces

- `DiscussionDocumentRepository`
- `ClipboardImageProvider`
- `ExternalLinkOpener`
- `DocumentOpenService`
- `FileAssociationService`
- `ParticipantSettings`
- `UpdateService`

## 6. Rich-text editor proof of concept

This is one of the highest-risk parts of the product. Evaluate at least one browser editor (for example,
TipTap/ProseMirror or Lexical) and compare it with the intended JavaFX implementation.

The proof of concept must verify:

- Heading levels 1–3.
- Bold, italic, underline, text color, and background color.
- Nested bullet and numbered lists.
- Links and embedded images.
- Selecting text across multiple formatting spans.
- A reliable "Reply to this" action for the selected range.
- A stable stored quote and source-message reference.
- Correct inherited context in a branch.
- Persistence and restoration after closing and reopening.
- Clipboard image paste and embedding.

Do not choose an editor based only on a demo. Test the exact branching interaction.

## 7. File association and multi-instance proof of concept

For each candidate framework, build a minimal packaged Windows application that can:

1. Register `.branchchat` for the current Windows user.
2. Unregister the association.
3. Receive a file path when launched by double-clicking a `.branchchat` file.
4. Validate the path and show a useful error for missing or invalid files.
5. Forward a second open request to an already running instance, if supported.
6. Open the document without a network connection.
7. Preserve the association and application settings during an update.

Verify behavior on a clean Windows 10/11 environment, not only on the development machine.

## 8. GitHub Releases update strategy

The updater must match the selected delivery model.

Required behavior:

- Stable releases only.
- Background update check and manual **Help > Check for updates**.
- Display version, release date, notes, and download size.
- Download only the expected Windows artifact.
- Verify SHA-256 when a checksum is published.
- Stage the update and apply it safely, with the application closed if necessary.
- Preserve user settings and discussion files.
- Provide a recovery path if replacement fails.
- Do not update or rewrite discussion documents.
- Work normally when offline; update failure must not block local use.

A portable single-EXE update may require a small launcher/updater helper or a user-confirmed replacement step because a
running Windows executable cannot reliably replace itself. Include this in the packaging proof of concept.

## 9. Provisional recommendation and decision process

Do not retain Spring Boot automatically merely because it is already in the project. Keep it only if it provides
concrete value after the packaging and runtime design is known.

Recommended evaluation sequence:

1. Prototype the rich-text selection-to-branch interaction in JavaFX.
2. Prototype the same interaction using a browser editor in the strongest web-shell candidate.
3. Package both candidates for Windows.
4. Test single-EXE feasibility, file association, second-instance behavior, offline operation, and update flow.
5. Compare implementation effort, package size, startup time, reliability, and maintenance burden.
6. Select the simplest option that satisfies the product requirements.

A reasonable default is to keep JavaFX if it meets the rich-text requirements and produces an acceptable self-contained
Windows package. Choose a web-based desktop shell only if its editor and UI advantages justify the new toolchain and
packaging complexity.

## 10. Proof-of-concept acceptance checklist

- [ ] Launches on a clean Windows 10/11 machine without manually installing a runtime.
- [ ] Output is a single `.exe`, or the smallest practical self-contained package.
- [ ] Registers and unregisters `.branchchat` safely.
- [ ] Double-clicking a `.branchchat` file opens the correct discussion.
- [ ] Opening a second document while the app is running behaves predictably.
- [ ] Works fully offline for create, open, edit, and save.
- [ ] Supports required formatting and nested lists.
- [ ] Text selection across formatting spans is reliable.
- [ ] "Reply to this" creates a branch with the correct quote and context.
- [ ] Clipboard images are embedded and survive reopening.
- [ ] Large discussions remain responsive.
- [ ] GitHub update flow verifies and applies the correct Windows release.
- [ ] Failed update does not damage the application or discussion documents.

## 11. Decision record

Complete this section after the proof of concept.

| Decision                            | Selected option       | Rationale |
|-------------------------------------|-----------------------|-----------|
| UI framework                        | TBD                   |           |
| Rich-text editor                    | TBD                   |           |
| Windows packaging format            | TBD                   |           |
| Single-EXE feasibility              | TBD                   |           |
| `.branchchat` association mechanism | TBD                   |           |
| Multi-instance/open-file behavior   | TBD                   |           |
| Document schema and ZIP layout      | ZIP + JSON (proposed) |           |
| Update mechanism                    | TBD                   |           |
| Keep or remove Spring Boot          | TBD                   |           |