# Code review: suggested improvements

**Date:** 2026-11-18  
**Scope:** `src/` (151 files, about 25 000 lines) and `tests/` (about 17 000 lines), at commit "Release notes 4.0.0".
Documents were not reviewed.  
**Method:** reading of the main modules, searches for patterns over the whole tree, and the tool configuration. The
findings marked **(checked)** were confirmed in the code; the others are suggestions from reading.

---

## 1. Summary

The code base is in good condition for its size. Strong points that should stay:

- TypeScript `strict` with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`.
- Clear layers: `src/shared` is pure (enforced by ESLint `no-restricted-imports`), `main` and `renderer` talk only
  through a narrow preload API. Every IPC channel checks its sender frame and validates its payload with Zod.
- All input from disk and from the shared folder is validated with Zod schemas; protocol schemas are `.strict()`.
- Dependencies are injected (`now`, `newId`, ports for Electron, file system, and updater), so most logic is unit
  tested without Electron.
- 480 unit tests and 134 end-to-end tests; lint, format check, typecheck, and tests run in CI; a leak check keeps test
  hooks out of release builds.
- Requirement IDs (FR-xxx, D-xx) in comments give good traceability.

The main points for improvement:

1. One user-visible bug: internal English error messages reach the Russian interface (Section 2.1).
2. The linting is not type-aware and has no React hooks rules, so a class of async and hook bugs is not caught
   (Section 3).
3. A few modules are too large and do too many things: `conversationSync.ts` (1 649 lines), `ipc/handlers.ts`
   (81 channels in one function), `repository.ts`, and four React components above 550 lines (Section 4).
4. Errors are swallowed silently in many places, and unknown errors in IPC handlers are not logged (Section 5).
5. Some type safety is bypassed with `as unknown as` in production code (Section 6).

---

## 2. Bugs found during the review

### 2.1 Internal English error texts are shown to the user (high) (checked)

`src/main/ipc/handlers.ts`, `toError()`:

```ts
message: err instanceof DomainError ? err.message : describeError(err.code)
```

`DomainError` messages are developer texts in English, for example `'a branch needs a non-empty selected passage'`
(`shared/domain/branching.ts`) or `'unknown reaction'`. The renderer shows `error.message` directly in 35 places, so a
Russian (or English) user sees the internal text. `ru.ts` and `en.ts` already have texts for these codes
(`EMPTY_QUOTE`, `INVALID_SELECTION`, `THREAD_CLOSED`, …).

Also in `toError()`: the text `'Invalid request.'` for a `ZodError` is hard-coded in English and not in `ru.ts`/`en.ts`
(NFR-205).

**Suggestion:** use `describeError(err.code)` for every known error class; add `INVALID_REQUEST` to the texts; add a
unit test that each code of `DomainErrorCode`, `AppErrorCode`, `DocumentErrorCode`, and `LibraryError` has a text in
both languages.

### 2.2 Unknown errors in IPC handlers are lost (medium) (checked)

`toError()` turns any other error into `UNKNOWN` without logging it. A programming error in a handler leaves no trace
in the log file, so the diagnostics report (FR-323) cannot help.

**Suggestion:** log the error name, message, and stack (with the existing redaction) before returning `UNKNOWN`.

### 2.3 Version in `package.json` (medium) (checked)

`package.json` has `"version": "1.0.0"`. The updater, the log, and the generator field of exported files use this
value. The release note is for 4.0.0.

**Suggestion:** set the version from the release tag in one place, and fail the release workflow if the tag and
`package.json` differ.

---

## 3. Tooling

| No. | Suggestion                                                                                                                                                                                                                                             | Why                                                                                                                                                           | Effort |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|--------|
| T-1 | Turn on type-aware linting (`tseslint.configs.recommendedTypeChecked`, with `parserOptions.projectService`). At least: `no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unnecessary-type-assertion`, `switch-exhaustiveness-check` | About 90 promises are started with `void` on purpose; the rule makes every other forgotten `await` an error. Exhaustive switches protect the event types      | M      |
| T-2 | Add `eslint-plugin-react-hooks` (`rules-of-hooks`, `exhaustive-deps`)                                                                                                                                                                                  | The large components use many `useEffect`/`useCallback`/`useMemo` with hand-written dependency lists and refs to work around stale values                     | S      |
| T-3 | Add `eslint-plugin-jsx-a11y`                                                                                                                                                                                                                           | NFR-003/NFR-206 ask for keyboard and screen reader use; today only e2e tests check a part of it                                                               | S      |
| T-4 | Measure coverage (`vitest --coverage` with v8) in CI, first as a report, later with a lower limit for `src/shared` and `src/main`                                                                                                                      | There is no number today; the renderer has only 2 unit test files                                                                                             | S      |
| T-5 | Find unused exports and files with `knip` (or `ts-prune`)                                                                                                                                                                                              | The code grew over many phases; some exports and texts may be unused                                                                                          | S      |
| T-6 | Consider `exactOptionalPropertyTypes: true`                                                                                                                                                                                                            | Many objects are built with `...(x ? { k: x } : {})` to keep `undefined` out of protocol JSON (canonical JSON refuses `undefined`); the compiler can check it | M      |
| T-7 | Check for circular imports in CI (`madge --circular` or `eslint-plugin-import` `no-cycle`)                                                                                                                                                             | `i18n/en.ts` imports a type from `i18n/index.ts`, which imports `en.ts` (a type-only cycle, harmless today); nothing checks for cycles                        | S      |

---

## 4. Structure and size

### 4.1 `src/main/sync/conversationSync.ts` (1 649 lines)

One class does sending (outbox, parts, attachments), receiving (scan, open, check, apply, pending queue, parts,
attachments), receipts, cleanup, key changes, re-joining, limits, and status. `processFile` has about 170 lines and
`enqueue` about 120.

**Suggestion:** keep `ConversationSync` as the coordinator and move parts into units with their own tests:

- `Outbox` (envelopes, part planning, writing, retries, cleanup after receipts),
- `InboxReader` (stable-file check, open, verify, quarantine, replay check),
- `EventProcessor` per kind: document events, parts, receipts, key events, limits,
- `AttachmentLoader` (loads, deferred files, joining).

Each unit gets the same injected `state`, `transport`, and `now`. The existing tests stay as integration tests.

### 4.2 `src/main/ipc/handlers.ts` (81 channels in one function)

`registerIpcHandlers` has 8 positional parameters and an optional bag, and registers all channels in one function of
about 450 lines.

**Suggestion:** one module per area (`ipc/document.ts`, `ipc/sync.ts`, `ipc/library.ts`, `ipc/settings.ts`,
`ipc/attachments.ts`, …), each exporting `register(handle, deps)`. Pass one typed `deps` object instead of positional
parameters. Keep `handle()` (sender check and validation) in one place.

### 4.3 `src/main/library/repository.ts` (735 lines)

The repository has discussions, messages, the search index, attachments, blobs, drafts, unread counts, and meta values.

**Suggestion:** split by table group (`DiscussionRows`, `BlobRows`, `DraftRows`, `MetaRows`) behind the same
`LibraryRepository` facade, so callers do not change.

### 4.4 Large React components

| Component              | Lines | `useState` | Suggestion                                                                                                              |
|------------------------|-------|------------|-------------------------------------------------------------------------------------------------------------------------|
| `SharedWizard.tsx`     | 654   | 15         | One component per mode (new, convert, join, invite, reinvite) with a shared step list; state in a `useReducer`          |
| `SettingsDialog.tsx`   | 611   | 16         | One component per section (name, keys, startup, text size, background, backups, attachments, language, updates)         |
| `DiscussionScreen.tsx` | 590   | –          | Move the search bar logic and the branch header into own components                                                     |
| `Composer.tsx`         | 561   | 8          | Custom hooks: `useDrafts(threadId)`, `useAttachments()`, `useImageUpload()`; many refs mirror state for callbacks today |
| `App.tsx`              | 432   | 19         | A small state container (context + reducer) for view, dialogs, and settings                                             |

### 4.5 The renderer API

The renderer calls `window.branchchat` directly in 12 files (33 places), and the result handling repeats in about 35
places: `if (r.ok) … else setError(r.error.message)`.

**Suggestion:** provide the API through a React context (easier to fake in component tests) and a small helper such as
`useIpcAction()` that runs a call, sets busy state, and reports the error in one way.

### 4.6 One CSS file

`src/renderer/src/styles.css` has about 1 500 lines for all components.

**Suggestion:** one CSS file per component (or CSS modules), imported by the component. This makes dead styles easier
to find.

---

## 5. Error handling

| No. | Finding                                                                                                                                                            | Suggestion                                                                                                            |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| E-1 | 23 places use `.catch(() => undefined)` and 52 use `catch { }` (checked). Many are correct "best effort" steps (cleanup, temporary files), but they leave no trace | A helper `bestEffort(promise, log, what)` that logs at debug level; keep silent catches only where a comment says why |
| E-2 | Four error classes with the same shape: `AppError`, `DocumentError`, `DomainError`, `LibraryError` (checked)                                                       | A common base `CodedError` with `code`; `toError()` then needs one check, and Section 2.1 cannot happen again         |
| E-3 | Unhandled promise results from `void x.then(...)` in the renderer can lose errors                                                                                  | T-1 finds them; the `useIpcAction()` helper (4.5) handles them                                                        |

---

## 6. Type safety

| No. | Finding                                                                                                                                                                                                            | Suggestion                                                                                                       |
|-----|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| Y-1 | `LocalEvent` covers only document events, so `member.limits.set` and `member.keys.replaced` are sent with `as unknown as LocalEvent`, and attachment payloads are read with casts (`conversationSync.ts`, checked) | A union type `OutgoingEvent` over all event types that `enqueue()` accepts, with the payload type tied to `type` |
| Y-2 | `sync: null as unknown as ConversationSync` in `syncService.ts` for two-step building (checked)                                                                                                                    | Build the object after the `ConversationSync` exists, or make the field `ConversationSync                        | null` with a guard                     |
| Y-3 | 26 non-null assertions (`!`) in `src` (checked)                                                                                                                                                                    | Replace them with a guard or a small `must(value, what)` helper that throws a clear error                        |
| Y-4 | `node:sqlite` is loaded with `as unknown as` (`library/db.ts`) because Node 22 types lack it                                                                                                                       | Keep, but put the declared types in one `.d.ts` file                                                             |

---

## 7. State and side effects

| No. | Finding                                                                                                                                                                                      | Suggestion                                                                                                      |
|-----|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| S-1 | `SyncState.data` is changed directly from many places (`this.state.data.…` about 40 times in `conversationSync.ts`)                                                                          | Methods on `SyncState` for each change (`recordLimit()`, `deferFile()`, …), so its invariants live in one class |
| S-2 | Some code uses `new Date()` or `Date.now()` directly in `src/main` (16 places, for example `repository.setDraft`, `migration.ts`, `onboarding.ts`), while most code uses an injected `now()` | Inject `now` everywhere, so tests control time and the library has one time source                              |
| S-3 | `ipcMain.on(IPC.languageGet)` in `index.ts` does not check the sender, unlike every other channel (checked)                                                                                  | Low risk (it returns only the language), but use the same sender check for consistency                          |
| S-4 | Module-level mutable state (`setLanguage`, `setQuietWindows`) is set once at start                                                                                                           | Acceptable; document the rule "set before the first window" and fail if it is set twice                         |

---

## 8. Tests

| No.  | Finding                                                                                                                                         | Suggestion                                                                                                               |
|------|-------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| TS-1 | The renderer has only 2 unit test files; most UI behavior is tested only by e2e tests                                                           | Component tests with Testing Library and a fake API (possible after 4.5) for the composer, sidebar, search, and settings |
| TS-2 | The sync test helpers (`makeKeys`, `group`, member setup) are copied in `conversationSync.test.ts` and `reactionsAttachments.test.ts` (checked) | Move them to `tests/helpers/sync.ts`                                                                                     |
| TS-3 | `shared.spec.ts` fails rarely on the CI runner; the cause is not known yet                                                                      | The new failure artifacts will show it; avoid fixed waits; give the slow steps (create, join) an explicit timeout        |
| TS-4 | No test checks that every error code has a text (Section 2.1)                                                                                   | Add it next to the existing test of equal keys in `ru.ts` and `en.ts`                                                    |
| TS-5 | Test file and test names mix languages and requirement IDs                                                                                      | Keep one rule: behavior in the name, requirement ID in brackets (as most tests do now)                                   |

---

## 9. Smaller points

- **Magic numbers:** timeouts and sizes (2 s stable time, 10 minutes, 30 days, 4 MiB, 7 backups) are in several files.
  Collect them in one `constants.ts` per area with a short comment each.
- **Comments:** many comments tell what a line does; the useful ones tell why (requirement, Windows behavior). Keep the
  "why" comments, remove "what" comments when the code says the same.
- **Long parameter lists:** constructors with option objects are used well; `registerIpcHandlers` is the exception
  (4.2).
- **Public API of modules:** `index.ts` files export everything (`export *`). Exporting only what other layers use makes
  the boundaries clearer and helps T-5.
- **Dependencies:** run `npm audit` and an update check in CI (for example Dependabot), as Electron needs security
  updates often.

---

## 10. Suggested order

| Step | Content                                   | Why first                                     |
|------|-------------------------------------------|-----------------------------------------------|
| 1    | 2.1, 2.2, E-2, TS-4 (**done** 2026-11-18) | A visible bug, small change                   |
| 2    | T-1, T-2 (fix what they find)             | Finds real bugs; protects all later refactors |
| 3    | Y-1, Y-2, S-1                             | Small, makes 4.1 safer                        |
| 4    | 4.2, 4.3, TS-2                            | Mechanical splits, no behavior change         |
| 5    | 4.1                                       | The largest change; needs steps 2 to 4        |
| 6    | 4.5, then 4.4 and TS-1                    | UI structure, with component tests            |
| 7    | T-3 to T-7, Section 9                     | Continuous improvement                        |

Each step can be one change with all tests passing; steps 4 to 6 change no behavior.
