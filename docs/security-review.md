# Security review (phase 9)

Reviewed against ADR-001 section 7 and requirements NFR-005 to NFR-010, NFR-016 and acceptance criterion 23. The
automated evidence is `tests/e2e/security.spec.ts` and the unit tests in `tests/validation` and `tests/document`.

## Threat model

The main risk is a `.branchchat` file received from someone else (WhatsApp, e-mail): it is untrusted input. The
application has no server and no accounts. Secondary risks: the update channel, and links or images inside messages.

## Controls and evidence

| Area                | Control                                                                                                                                        | Evidence |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Malicious files     | Structural limits are **not** applied, but every file is validated: ZIP names (no absolute paths, no `..`, no duplicates), JSON schema (zod), rich-text subset, integrity (dangling sources, unknown asset references), image type by content | malicious-file matrix in `security.spec.ts` (not a ZIP, empty, truncated, zip-slip, duplicate entry, missing discussion, bad JSON, `javascript:` and `file:` links, script node, dangling source, SVG asset) |
| Rendering           | Messages are structured JSON, never HTML. Markup typed in a message is shown as text. Links open only on an explicit click, only `http`, `https`, `mailto` | `security.spec.ts` "markup as text" |
| Renderer isolation  | `contextIsolation` on, `nodeIntegration` off, `sandbox` on, `webSecurity` on, narrow `contextBridge` API                                         | `security.spec.ts` "secure webPreferences" |
| IPC                 | Every channel validates its arguments, checks that the sender is the main frame of an application page (`file://`), and returns typed errors    | IPC validation matrix |
| Network             | Default session cancels every `http(s)` and `ws(s)` request; the updater uses its own session. CSP: `default-src 'self'; script-src 'self'; connect-src 'none'; object-src 'none'` | `security.spec.ts` fetch/image/eval/CSP |
| Navigation          | `will-navigate`, `will-redirect` and `window.open` blocked; iframes blocked                                                                      | `security.spec.ts` navigation |
| Permissions         | Permission requests, permission checks and device permissions all denied                                                                         | `security.spec.ts` |
| Developer tools     | Disabled in packaged builds                                                                                                                      | `mainWindow.ts` |
| Electron fuses      | `RunAsNode` off, `NODE_OPTIONS` off, `--inspect` off, cookie encryption on, ASAR integrity on, only load from ASAR (verified on the packaged build with `@electron/fuses read`). `GrantFileProtocolExtraPrivileges` stays at its default because the application is loaded from `file://` | packaging step |
| Test code           | Test hooks exist only in `--mode e2e`; the release build is searched for them in CI and in the release workflow                                   | `release.yml` |
| Updates             | GitHub Releases over HTTPS, stable only, SHA-512 verified by electron-updater, corrupted download rejected, update never touches discussions     | `updates.spec.ts` |
| Privacy             | No telemetry. The only outgoing traffic is the update check (NFR-008)                                                                            | `windows-test-checklist.md` H9 |
| Supply chain        | Releases are built only by CI from a tag; two-factor authentication on the GitHub account; SHA-256 published with every release                 | `release-process.md` |

## Accepted risks

- **Unsigned installer (decision, NFR-016).** Windows SmartScreen warns on first download. Mitigation: documented steps
  in the user guide and release notes, SHA-256 in every release, CI-only builds. A later release may add signing
  (see implementation plan section 10).
- **Read status is visible to others** by design (FR-125); the person is told once.
- **A file from an untrusted person can be very large.** No limit is enforced by decision (NFR-015); a huge file only
  slows the application, it cannot execute code.
- **Spell check** uses the Windows spell checker; words are not sent anywhere by BranchChat.

## Not covered

Penetration testing by a third party; dynamic analysis of Chromium itself (kept current by upgrading Electron).
