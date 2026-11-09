# BranchChat

Offline-first Windows desktop app for discussions that branch from selected text. One portable `.branchchat` file per
discussion, shared through WhatsApp or any file-sharing tool.

Stack: Electron + TypeScript, React, TipTap (from phase 3), electron-builder (NSIS), electron-updater (phase 8).
Design documents are in [`docs/`](docs): requirements, ADR-001, and the implementation plan.

## Commands

| Command             | What it does                                                                                 |
|---------------------|----------------------------------------------------------------------------------------------|
| `npm install`       | Install dependencies                                                                         |
| `npm run dev`       | Start the app with hot reload                                                                |
| `npm run build`     | Build main, preload and renderer into `out/`                                                 |
| `npm test`          | Unit tests (Vitest): domain, validation, document format                                     |
| `npm run test:e2e`  | Builds a test build (`--mode e2e`, dialogs stubbed) and runs the Electron tests (Playwright) |
| `npm run lint`      | ESLint, including the import-boundary rules                                                  |
| `npm run typecheck` | TypeScript for main/shared and renderer/shared                                               |
| `npm run package`   | Build the unsigned per-user installer `dist/BranchChat-Setup.exe`                            |

On Linux as root, run the e2e tests with `BRANCHCHAT_NO_SANDBOX=1 xvfb-run -a npm run test:e2e`.

## Layout

```
src/
  shared/      pure TypeScript, no Electron/React/Node: domain rules, schemas, types
    domain/      discussion, branching, context resolution, read-state rules
    validation/  zod schemas, rich-text subset, editor-to-stored conversion, link input rules, integrity checks
  main/        Electron main process
    document/    .branchchat ZIP reading/writing, atomic save, images, migrations
    windows/     launch arguments, process-wide security
    application/ controller (windows, open/new/close), document session (autosave queue), menu, dialogs
    local-state/ participant settings (name, ID)
    e2e/         test hooks, compiled only into `--mode e2e` builds
    ipc/         validated IPC handlers
  preload/     the narrow contextBridge API
  renderer/    React UI: components/chat (list, composer), components/branches (panel, header), components/editor (TipTap), components/rich (renderer)
tests/         unit tests and tests/e2e
docs/          requirements, ADR, implementation plan
```

Lint enforces the boundaries: `shared/` may not import Electron, React or Node built-ins; the renderer may not import
Electron, Node built-ins or `main/`.

## Document format (schema version 1)

A `.branchchat` file is a ZIP:

```
manifest.json     format name, schemaVersion, documentId
discussion.json   participants, threads (messages inside), asset index
readstate.json    participantId -> IDs of messages that participant has read
assets/images/<sha256>.<png|jpg|gif|webp>
```

Messages hold structured rich text (a documented ProseMirror/TipTap JSON subset, never HTML) and are immutable. Display
order is append order (`sequence`), not timestamps. Unknown optional fields and unknown ZIP entries are preserved on
save. Files from a newer schema version are refused, never rewritten.

## Status

See `docs/implementation_plan.md`.

- Phase 0 (foundation): done except the clean-machine install test, which needs Windows (CI builds the installer).
- Phase 1 (domain and document format): done, covered by unit tests.
- Phase 2 (application shell and document lifecycle): done. Create, open, autosave, one window per document,
  participant name, close warnings, error handling. Covered by unit tests and 15 Electron end-to-end tests.
- Phase 3 (chat UI and rich-text editor): done. TipTap composer with the supported formatting, read-only rendering
  from the stored structure, safe links, virtualized message list. 123 unit tests and 23 Electron end-to-end tests.
- Phase 4 (branching): done. "Reply to this" from any selection, inherited context with the quoted passage highlighted,
  nested branches, side panel (active/closed), titles, close/reopen, badges, go to source. 150 unit tests and 33
  Electron end-to-end tests.
- Phase 5 (unread messages): done. Unread highlighting, mark as read (message, thread, all), read-on-reply, panel
  counts,
  window title count, read indicators, one-time notice. 157 unit tests and 40 Electron end-to-end tests.
- Phase 6 (images): done. Paste, drop and file chooser; inline display and larger view; placeholders; no size limit.
  181 unit tests and 52 Electron end-to-end tests.
- Next: phase 7 (Windows integration: installer option for the `.branchchat` association).
