Status: Options analysis; final technology decision pending proof of concept
Decision scope: Windows 10 and Windows 11 desktop application
Existing project: JavaFX + Spring Boot + Gradle
Product constraints: Offline-first, one portable discussion file, file exchange through WhatsApp, rich-text chat UI, clipboard images, GitHub Releases updates, simple Windows delivery and file association.

1. Executive summary
   BranchChat is a Windows desktop application. Other platforms are outside the product scope and should not influence the technology choice.

The architecture decision should be driven by the Windows user experience and deployment requirements:
- Prefer a single self-contained .exe that users can launch directly.
- Avoid requiring users to install Java, Node.js, a browser, a local server, or other runtime dependencies.
- Associate a discussion file extension (proposed: .branchchat) with BranchChat.
- Double-clicking a .branchchat file in Windows Explorer should launch BranchChat and open the selected discussion.
- If a single executable is impractical, choose the simplest self-contained Windows package and document the trade-off.
  Four practical technology options deserve evaluation:
1. JavaFX + Java — reuse the existing project and build a native desktop application.
2. Web UI + local Spring Boot service — use a modern web frontend while retaining Java services.
3. TypeScript + Tauri — use a web frontend with a lightweight desktop shell and Rust host.
4. TypeScript + Electron + Node.js — use a web frontend and Node.js desktop application runtime, with most application logic written in TypeScript.
   Provisional recommendation: build small prototypes for JavaFX and at least one TypeScript-based desktop option. Test the actual packaging, rich-text editing, file association, offline operation, and update workflows before choosing.

The framework should be selected based on the simplest implementation that satisfies the product requirements, not on theoretical advantages.
2. Decision drivers
   Driver	Importance	What to verify
   Single-file or very simple delivery	Critical	Can the user receive and run one .exe without installing a runtime?
   Windows file association	Critical	Can .branchchat be registered, removed, and passed to the app reliably?
   Offline operation	Critical	Does opening, editing, and saving work without a network connection?
   Rich-text selection and branching	Critical	Can selection span formatting boundaries and retain a stable quote?
   Clipboard images	High	Can images be pasted and embedded in the discussion file?
   Native Windows experience	High	File dialogs, drag-and-drop, DPI, keyboard shortcuts, multi-window behavior
   GitHub Releases updates	High	Can updates be checked, verified, staged, and applied without damaging documents?
   Existing Java code reuse	Medium	How much of the current JavaFX/Spring Boot/Gradle project remains useful?
   TypeScript development	Medium	Can most application logic be written in TypeScript?
   Maintenance burden	High	How many languages, runtimes, packaging systems, and update mechanisms are required?
   Application footprint	Medium	What are the executable size, startup time, and memory consumption?

3. Technology options
   Option A — JavaFX desktop application
   Keep JavaFX as the primary UI and retain Java for the application and domain layers.

Advantages
- Reuses the existing project and team knowledge.
- Native desktop application lifecycle.
- Straightforward access to Windows file dialogs, clipboard, drag-and-drop, and file associations.
- Java domain and ZIP-document code can remain independent of the UI.
- jpackage can create Windows application images and installers.
- Does not require a browser-based frontend or a separate JavaScript runtime.
  Risks and limitations
- Rich-text editing may require more custom work than a browser-based editor.
- A true single-file executable is not guaranteed. Java runtime packaging and native launchers commonly produce a package or application image rather than one self-contained .exe.
- File association registration may be handled by an installer or a first-run registration flow.
- A portable executable cannot assume it has permission to change system-wide associations.
- JavaFX WebView can host a web editor, but that creates a hybrid UI with JavaFX/web integration complexity.
  Best fit when
- Reusing the existing Java project and native Windows behavior matter more than adopting a browser-based editor.
- The rich-text proof of concept meets selection, formatting, and image requirements.
- A self-contained package is acceptable if a single .exe proves impractical.
  Option B — Web frontend with a local Java/Spring Boot host
  Build the UI with React, Vue, or another web framework and have a local Java process serve it and expose application services.

Possible stack
- Java + Spring Boot — application services and document handling.
- React or Vue — frontend.
- TypeScript — frontend language.
- Browser-based rich-text editor — message composition and formatting.
- Local HTTP API — communication between frontend and Java backend.
  Advantages
- Access to mature browser-based rich-text editors and selection APIs.
- Existing Java domain and ZIP-document code can be reused.
- UI and domain/document layers can be separated cleanly.
- TypeScript can be used for the entire frontend.
- Existing Gradle and Spring Boot project structure can remain useful.
  Risks and limitations
- Opening a browser tab at localhost may feel less like a conventional Windows desktop application.
- A local server introduces port selection, process lifecycle, browser security, and local API protection requirements.
- Packaging a Java runtime, browser experience, and startup flow into one .exe is not straightforward.
- File associations and passing the opened document path from Windows to the running local app need explicit implementation.
- Users should not be asked to start Spring Boot manually.
- The Windows application lifecycle and browser lifecycle must be coordinated.
  Best fit when
- The rich-text editor is decisive and a browser-hosted experience is acceptable.
- The team wants to preserve Java services and is willing to invest in desktop packaging and process management.
  Security requirements if selected
- Bind only to 127.0.0.1, never all network interfaces.
- Use a per-launch secret or token for local API requests.
- Restrict allowed origins and validate every request.
- Do not expose arbitrary filesystem access through the local API.
- Shut down the local service cleanly when the application exits.
  Option C — TypeScript frontend in a Tauri desktop shell
  Use React, Vue, or another TypeScript-based frontend, packaged as a Windows desktop application using Tauri.

Possible stack
- TypeScript — frontend and potentially domain logic.
- React or Vue — UI.
- Tauri — desktop application shell.
- Rust — native host and integrations.
- JSON and ZIP — discussion document format.
  Advantages
- Modern web-based UI and rich-text editor ecosystem.
- Native Windows integration through Tauri commands and plugins.
- Smaller runtime footprint than Electron in many configurations.
- Frontend and domain logic can be written primarily in TypeScript.
- No requirement to retain Spring Boot.
- Can use the operating system's WebView rather than bundling a full Chromium runtime.
  Risks and limitations
- Introduces Rust for the desktop host and native integrations.
- Requires learning and maintaining both Rust and TypeScript.
- Some Windows integrations require plugins or custom native code.
- Single-EXE delivery must be verified.
- Portable application updates and file associations need explicit implementation.
- The Tauri plugin ecosystem and packaging behavior must be validated against the specific application requirements.
  Best fit when
- A modern web UI is desirable.
- Runtime size matters.
- The team accepts introducing Rust alongside TypeScript.
- The proof of concept demonstrates reliable Windows packaging and integration.
  Option D — Node.js + TypeScript desktop application using Electron
  Use TypeScript for the application logic and frontend, with Electron providing the Windows desktop runtime.

Possible stack
- Node.js — main application process and backend services.
- TypeScript — application and domain logic.
- React or Vue — frontend.
- Electron — desktop runtime.
- Electron Forge or electron-builder — packaging.
- JSON and ZIP — discussion document format.
  Electron provides a desktop application environment using Chromium for rendering and Node.js for the main application process. It has separate main and renderer processes connected through controlled APIs.

Advantages
- The application can be developed almost entirely in TypeScript.
- No Rust requirement.
- Large ecosystem of JavaScript and TypeScript libraries.
- Mature web UI and rich-text editor ecosystem.
- Direct access to Node.js filesystem and application services from the main process.
- Windows file opening, dialogs, clipboard, and application lifecycle can be handled through Electron APIs.
- Established packaging tools and a broad set of examples.
- Can implement ZIP document handling and branching logic in TypeScript without Spring Boot.
  Risks and limitations
- Electron bundles Chromium and Node.js, so the resulting application is generally larger than a comparable Tauri application.
- Higher memory consumption is likely than with a lightweight native desktop application.
- Electron has a security-sensitive process architecture. Renderer processes should not receive unrestricted Node.js access.
- Requires careful configuration of context isolation, preload scripts, IPC, and content security policy.
- A single portable .exe is possible as a packaging target, but it needs to be tested against the desired file-association and update workflows.
- The Electron runtime and frontend dependencies must be maintained and updated.
- A portable executable update workflow may require a separate updater or replacement mechanism.
  Windows packaging

Possible distribution formats include:
1. Portable .exe — no conventional installation; potentially suitable for the preferred delivery model.
2. Windows installer .exe — can register file associations and install application files.
3. MSIX — Windows application package.
   Electron packaging tools document portable Windows executable targets, but automatic updating has different capabilities depending on packaging format. Electron's built-in Windows updater should not be assumed to work with a generic portable executable.

File association

Electron can handle application startup with a document path supplied by Windows. The application still needs to register the .branchchat association and implement handling for subsequent file-open requests.

The proof of concept must test:
- Registration and removal of .branchchat.
- Opening a file by double-clicking it.
- Opening a second document when the app is already running.
- Portable executable behavior when moved to another directory.
- File association behavior after an application update.
  Security requirements
- Keep nodeIntegration disabled in renderer processes.
- Enable contextIsolation.
- Use preload scripts and contextBridge to expose a narrow set of application APIs.
- Validate all IPC requests and filesystem paths.
- Do not allow arbitrary renderer requests to access the filesystem.
- Keep document parsing and filesystem operations in the main process or a controlled utility process.
- Apply an appropriate Content Security Policy.
  Best fit when
- The developer prefers TypeScript over Java and Rust.
- A web-based rich-text editor is important.
- Application size and memory usage are acceptable.
- A portable Windows executable can be produced and tested successfully.
- Avoiding a separate Spring Boot service is desirable.
  Directional comparison
  Scores are relative estimates for this project, not benchmark results. Higher is better.
  Criterion	JavaFX	Local web + Spring Boot	Tauri	Electron
  Reuse of current Java project	5	5	2	1
  TypeScript ecosystem	1	5	5	5
  Rich-text editor ecosystem	3	5	5	5
  Windows integration	5	3	4	5
  Offline operation	5	5	5	5
  Single-EXE potential	3	2	3	4
  File association integration	4	3	4	5
  Simplicity with current stack	5	3	2	2
  Runtime/package footprint	4	3	5	2
  Need for Rust	0	0	5	0
  Need for Java	5	5	0	0

Scale: 1 = poor, 5 = strong. For "Need for Rust/Java", 5 means that technology is required.

The scores are provisional. The single-EXE score for Electron assumes a portable executable target; it does not imply that automatic updates and file association will work without additional implementation.
4. Windows delivery requirements
   Preferred user experience
1. The user downloads BranchChat.exe from the official GitHub Release.
2. The user launches it without installing Java, Node.js, or another runtime.
3. On first launch, BranchChat offers to associate .branchchat files with the application.
4. After association, double-clicking a .branchchat file in Explorer opens that discussion in BranchChat.
5. If the application is already running, opening another file should pass the document path to the existing instance where practical.
6. The user can remove the association through application settings or a clearly documented Windows flow.
   Packaging fallback order
   If a single executable is not feasible, evaluate these alternatives in order:
1. A self-contained portable folder distributed as a ZIP.
2. A conventional Windows installer that bundles required runtimes and registers file associations.
3. A more complex package only if it provides a clear user benefit.
   Do not require users to install a JRE, Node.js, configure environment variables, start a server, or manually manage technical dependencies.
   Portable versus registered
   A portable executable can run without installation, but Windows file association normally requires writing a registration to the user's Windows settings or using an installer or registration helper.

Therefore, portability and double-click opening are compatible only if BranchChat provides an explicit association-registration step and handles Windows permissions correctly.

Do not silently take over an existing file association. Explain the action and provide a way to undo it.
5. Application architecture
   Regardless of UI framework, keep the discussion model and document persistence independent of the presentation layer.

Suggested logical modules:
- Presentation: chat view, branch navigation, composer, formatting controls.
- Domain: discussion, participant, message, thread, branch rules, validation.
- Document: ZIP container, manifest, JSON serialization, schema versioning, migrations, atomic save.
- Assets: embedded images and other document resources.
- Windows integration: open-file arguments, file association, clipboard, drag-and-drop, external links.
- Updates: GitHub Releases lookup, stable-channel filtering, checksum verification, staging and replacement.
- Application services: autosave, settings, participant identity, error handling.
  Avoid making the domain model depend on JavaFX, Spring Boot, React, Tauri, Electron, or platform-specific UI APIs.
  Discussion file format
  Keep one self-contained file per discussion, for example discussion.branchchat, implemented as a ZIP container containing:

manifest.json
discussion.json
assets/
images/
attachments/

The document format is a product-level contract. It should not depend on the UI framework or packaging technology.
Suggested service interfaces
Conceptual interfaces:
- DiscussionDocumentRepository
- ClipboardImageProvider
- ExternalLinkOpener
- DocumentOpenService
- FileAssociationService
- ParticipantSettings
- UpdateService
  These interfaces may be implemented in Java or TypeScript depending on the selected stack.
  Suggested TypeScript project structure
  If a TypeScript-based option is selected, a possible structure is:

src/
main/
application/
document/
windows/
updates/
ipc/
renderer/
components/
chat/
branches/
editor/
domain/
discussion/
message/
participant/
branching/
shared/
types/
validation/

The domain and document modules should not depend on React or Electron renderer APIs.
6. Rich-text editor proof of concept
   This is one of the highest-risk parts of the product.

For web-based options, evaluate at least one browser editor, for example:
- TipTap / ProseMirror.
- Lexical.
  Compare the selected web editor with the intended JavaFX implementation.

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
7. File association and multi-instance proof of concept
   For each candidate framework, build a minimal packaged Windows application that can:
1. Register .branchchat for the current Windows user.
2. Unregister the association.
3. Receive a file path when launched by double-clicking a .branchchat file.
4. Validate the path and show a useful error for missing or invalid files.
5. Forward a second open request to an already running instance, if supported.
6. Open the document without a network connection.
7. Preserve the association and application settings during an update.
   Verify behavior on a clean Windows 10/11 environment, not only on the development machine.
8. GitHub Releases update strategy
   The updater must match the selected delivery model.

Required behavior:
- Stable releases only.
- Background update check and manual Help > Check for updates.
- Display version, release date, notes, and download size.
- Download only the expected Windows artifact.
- Verify SHA-256 when a checksum is published.
- Stage the update and apply it safely, with the application closed if necessary.
- Preserve user settings and discussion files.
- Provide a recovery path if replacement fails.
- Do not update or rewrite discussion documents.
- Work normally when offline; update failure must not block local use.
  Packaging-specific considerations
  JavaFX

Investigate how jpackage output can be updated. A running application should not attempt to replace its own executable files.

Spring Boot local web application

The updater must replace the packaged Java application and frontend assets while preserving user data and settings.

Tauri

Validate whether the built-in updater can support the selected Windows package format. If not, implement a custom update workflow.

Electron

Electron's built-in updater should be evaluated against the chosen packaging target. A portable .exe may need a separate updater or a user-confirmed replacement step.

A portable single-EXE update may require a small launcher/updater helper because a running Windows executable cannot reliably replace itself. Include this in the packaging proof of concept.
9. Provisional recommendation and decision process
   Do not retain Spring Boot automatically merely because it is already in the project. Keep it only if it provides concrete value after the packaging and runtime design is known.

Recommended evaluation sequence:
1. Prototype the rich-text selection-to-branch interaction in JavaFX.
2. Prototype the same interaction using a browser editor in a TypeScript-based desktop application.
3. Compare Electron and Tauri packaging if both remain realistic candidates.
4. Package candidates for Windows.
5. Test single-EXE feasibility, file association, second-instance behavior, offline operation, and update flow.
6. Compare implementation effort, package size, startup time, memory consumption, reliability, and maintenance burden.
7. Select the simplest option that satisfies the product requirements.
   Provisional assessment
- JavaFX is the lowest-risk choice for reusing the current project and Windows-native integration.
- Electron + TypeScript is a strong candidate if the developer prefers TypeScript and wants to use a mature web-based rich-text editor without introducing Rust.
- Tauri + TypeScript is a strong candidate if smaller runtime footprint is important and the team accepts Rust.
- Spring Boot + local web UI is reasonable if preserving the existing Java backend is a priority, but it adds local-server and packaging complexity.
  A reasonable default is to keep JavaFX if it meets the rich-text requirements and produces an acceptable self-contained Windows package.

If the JavaFX editor implementation becomes disproportionately difficult, Electron + TypeScript should be evaluated seriously. It may provide a more straightforward development experience than Tauri for a developer who prefers TypeScript and does not want to maintain Rust.

The final decision should follow the proof of concept rather than these initial assessments.
10. Proof-of-concept acceptance checklist
- [ ] Launches on a clean Windows 10/11 machine without manually installing a runtime.
- [ ] Output is a single .exe, or the smallest practical self-contained package.
- [ ] Registers and unregisters .branchchat safely.
- [ ] Double-clicking a .branchchat file opens the correct discussion.
- [ ] Opening a second document while the app is running behaves predictably.
- [ ] Works fully offline for create, open, edit, and save.
- [ ] Supports required formatting and nested lists.
- [ ] Text selection across formatting spans is reliable.
- [ ] "Reply to this" creates a branch with the correct quote and context.
- [ ] Clipboard images are embedded and survive reopening.
- [ ] Large discussions remain responsive.
- [ ] GitHub update flow verifies and applies the correct Windows release.
- [ ] Failed update does not damage the application or discussion documents.
- [ ] Package size and memory usage are measured.
- [ ] Application startup time is measured.
- [ ] No external runtime installation is required.
11. Decision record
    Complete this section after the proof of concept.
    Decision	Selected option	Rationale
    Desktop runtime	TBD: JavaFX / Tauri / Electron
    Main application language	TBD: Java / TypeScript
    UI framework	TBD: JavaFX / React / Vue
    Rich-text editor	TBD
    Node.js backend	TBD: Electron main process / separate service / none
    Windows packaging tool	TBD: jpackage / Tauri bundler / Electron Forge / electron-builder
    Windows packaging format	TBD
    Single-EXE feasibility	TBD
    .branchchat association mechanism	TBD
    Multi-instance/open-file behavior	TBD
    Document schema and ZIP layout	ZIP + JSON (proposed)
    Update mechanism	TBD
    Keep or remove Spring Boot	TBD

12. References
    Official project documentation to consult during implementation:
    JavaFX and Java packaging
- JavaFX: https://openjfx.io/
- Java jpackage: https://docs.oracle.com/en/java/javase/21/jpackage/
  Tauri
- Tauri project: https://github.com/tauri-apps/tauri
- Tauri architecture: https://v2.tauri.app/concept/architecture/
- Tauri documentation: https://v2.tauri.app/
  Electron and Node.js
- Electron documentation: https://www.electronjs.org/docs/latest/
- Electron process model: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron autoUpdater: https://www.electronjs.org/docs/latest/api/auto-updater
- Electron Forge: https://www.electronforge.io/
- electron-builder: https://www.electron.build/
  Rich-text editors
- TipTap: https://tiptap.dev/
- ProseMirror: https://prosemirror.net/
- Lexical: https://lexical.dev/

Final decision status
No framework has been selected yet.

The next useful engineering step is a small proof of concept that implements the same core interaction in JavaFX and one TypeScript desktop stack:
1. Open and save a .branchchat ZIP document.
2. Display messages in a chat interface.
3. Format message text.
4. Select text across formatting boundaries.
5. Create a branch using the selected text.
6. Display inherited conversation context.
7. Paste and embed an image.
8. Package as a Windows executable.
9. Register and test .branchchat file association.
10. Verify offline operation and the update process.
    The technology decision should be made after these tests, with particular attention to the single-EXE requirement and the reliability of text selection and branching.