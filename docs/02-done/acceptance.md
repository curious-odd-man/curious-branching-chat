# Acceptance matrix (requirements section 9)

How each criterion is verified. "Auto" = automated test that runs in CI; "Windows" = manual step on a real Windows
machine in `windows-test-checklist.md`. Status is filled in when the checklist is run on Windows (the sandbox that
produced this repository runs Linux and cannot do the Windows steps).

| #  | Criterion                                  | Auto                                                                             | Windows          | Status (sandbox) |
|----|--------------------------------------------|----------------------------------------------------------------------------------|------------------|------------------|
| 1  | Create a discussion                        | `lifecycle.spec.ts`                                                              | A                | Auto passed      |
| 2  | Autosave, reopen                           | `lifecycle.spec.ts`, `documentSession` tests, `text.spec.ts`                     | A                | Auto passed      |
| 3  | Send the file to another user              | format tests, `lifecycle.spec.ts` (copy and reopen)                              | I (WhatsApp)     | Windows pending  |
| 4  | Recipient continues the discussion         | `unread.spec.ts`, `lifecycle.spec.ts`                                            | I (WhatsApp)     | Windows pending  |
| 5  | Author and timestamp on every message      | `lifecycle.spec.ts`                                                              | A                | Auto passed      |
| 6  | Name remembered                            | `lifecycle.spec.ts` (name asked once)                                            | A                | Auto passed      |
| 7  | Formatting                                 | `editor.spec.ts`                                                                 | A                | Auto passed      |
| 8  | Paste images                               | `images.spec.ts`                                                                 | C                | Auto passed      |
| 9  | Images survive moving the file             | `images.spec.ts`                                                                 | I                | Auto passed      |
| 10 | Links only on explicit action              | `editor.spec.ts`, `security.spec.ts`                                             | -                | Auto passed      |
| 11 | "Reply to this", across formatting         | `branching.spec.ts`                                                              | -                | Auto passed      |
| 12 | Branch keeps source and quote              | `branching.spec.ts`, `text.spec.ts`                                              | -                | Auto passed      |
| 13 | Context history in a branch                | `branching.spec.ts`, domain tests                                                | -                | Auto passed      |
| 14 | Nested branches                            | `branching.spec.ts`                                                              | -                | Auto passed      |
| 15 | Active and closed branches                 | `branching.spec.ts`                                                              | -                | Auto passed      |
| 16 | Reopen closed branches                     | `branching.spec.ts`                                                              | -                | Auto passed      |
| 17 | Works offline                              | `security.spec.ts` (no network), `updates.spec.ts` offline                       | H7               | Auto passed      |
| 18 | Check stable GitHub Releases               | `updates.spec.ts` (local feed, real electron-updater)                            | H (real release) | Windows pending  |
| 19 | Update does not modify discussions         | `updates.spec.ts`                                                                | H3               | Auto passed      |
| 20 | Launch through association, also running   | `association.spec.ts`, `lifecycle.spec.ts`                                       | D                | Windows pending  |
| 21 | Install from a single exe on clean Windows | CI packaging, `installer-smoke.ps1`                                              | D                | Windows pending  |
| 22 | Unread messages                            | `unread.spec.ts`, domain tests                                                   | -                | Auto passed      |
| 23 | Malformed or malicious files               | `security.spec.ts`, validation and document tests                                | -                | Auto passed      |
| 24 | SmartScreen guidance and checksum          | `release.yml` publishes SHA-256; `user-guide.ru.md`, `release-notes-template.md` | real release     | Windows pending  |

NFR-003 (display and input): `display.spec.ts` (scaling 100–200 %, smallest window, keyboard, focus, forced colors).
Remaining on Windows: section I (real scaling and Windows high-contrast themes).

Recent discussions (FR-143 to FR-150): `recent.spec.ts` and `tests/application/recentFiles.test.ts`. The taskbar jump
list can only be checked on Windows (checklist section J, step 4); its content is unit-tested.
