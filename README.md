# BranchChat

Offline-first Windows desktop app for discussions that branch from selected text. One portable `.branchchat` file per
discussion, shared through WhatsApp or any file-sharing tool.

Stack: Electron + TypeScript, React, TipTap (from phase 3), electron-builder (NSIS), electron-updater (phase 8).
Design documents are in [`docs/`](docs): requirements, ADR-001, and the implementation plan.
Also there: [security review](docs/02-done/security-review.md), [performance results](docs/02-done/performance.md),
[acceptance matrix](docs/02-done/acceptance.md), [release process](docs/02-done/release-process.md), the Russian
[user guide](docs/other/user-guide.ru.md) and the Windows [test checklist](docs/windows-test-checklist.md).

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

## Installing an unsigned build (SmartScreen)

Releases are not code-signed yet. On first run Windows SmartScreen may show "Windows protected your PC": choose
**More info**, then **Run anyway** (in Russian Windows: **Подробнее**, then **Выполнить в любом случае**). Verify the
download
first with `Get-FileHash .\BranchChat-Setup.exe -Algorithm SHA256` and compare with the value on the release page. Full
steps in Russian: [`docs/user-guide.ru.md`](docs/other/user-guide.ru.md).

## Releasing

Releases are built by CI only: push a tag `vX.Y.Z` equal to `version` in `package.json` and
`.github/workflows/release.yml`
tests, packages the unsigned installer and publishes a stable GitHub Release with `latest.yml`, the blockmap and a
SHA-256. Details and the one-time setup (real GitHub owner in `electron-builder.yml`, public repository, two-factor
authentication) are in [`docs/release-process.md`](docs/02-done/release-process.md).

## Notes for developers

- `npm run build` makes the **release** build; `npm run build:e2e` makes the **test** build used by Playwright. They
  write to the same `out/` folder: after packaging, run `npm run build:e2e` again before running the e2e tests (a
  release build ignores the isolated test profile and test dialogs).
- Release builds must not contain test hooks (CI and the release workflow search for them).
- Offline spell check uses the Windows spell checker (Russian and English); it needs the Russian language pack.
