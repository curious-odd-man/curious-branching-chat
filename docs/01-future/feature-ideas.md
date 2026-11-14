# BranchChat: feature ideas

**Status:** Ideas for later releases. Not approved. Each item needs a design before work starts.
**Date:** 2026-11-14 (after release 1.5)

## Complexity scale

| Size | Effort (one developer, with tests and documents) |
|------|--------------------------------------------------|
| S    | 1–2 days                                         |
| M    | 3–7 days                                         |
| L    | 1–3 weeks                                        |
| XL   | more than 3 weeks                                |

"File" means the change needs a new schema version of the `.branchchat` file. "Protocol" means the change needs a new
event type or a change of the sync protocol (`sync-protocol.md`). Both make the work larger, because old versions of
the app must refuse or ignore the new data safely.

## Recommended first

These give the most value for the effort.

| #  | Feature                                        | Size | File | Protocol | Why                                                                                      |
|----|------------------------------------------------|------|------|----------|------------------------------------------------------------------------------------------|
| 1  | Search in a discussion (Ctrl+F)                | M    | —    | —        | Long discussions have no way to find a message. Search all branches, jump to the result   |
| 2  | Key backup with a passphrase                   | M    | —    | —        | Prevents most cases of "rejoin after key loss" (Windows reinstall, new computer)          |
| 3  | Several discussions in one window              | L    | —    | —        | In `todo.md`. A list of discussions on the left, one window instead of many               |
| 4  | Leave a discussion / remove a member           | L    | yes  | yes      | Release 1.5 limitation. Today a member cannot be removed                                  |
| 5  | Export to HTML, PDF, or Markdown               | M    | —    | —        | Archive, print, or send a discussion to a person without BranchChat                       |
| 6  | Branch filter (open, closed, unread, mine)     | S    | —    | —        | In "Later, if required" in `requirements.md`. Helps when a discussion has many branches   |

## Messages and chat

| #  | Feature                                    | Size | File | Protocol | Notes                                                                                           |
|----|--------------------------------------------|------|------|----------|-------------------------------------------------------------------------------------------------|
| 7  | Edit and delete own messages               | L    | yes  | yes      | Out of scope in `requirements.md` today. Needs an edit history and a "deleted" mark, not a real delete (other copies keep it) |
| 8  | Reactions (👍, ❤, …)                       | M    | yes  | yes      | A small event per reaction; last writer wins per person and emoji                               |
| 9  | Mentions (@name) with a notification       | M    | yes  | —        | A mention node in the rich text; the notification rule of release 1.4 gets one more case         |
| 10 | Pinned or bookmarked messages              | S–M  | yes  | yes      | Local bookmarks only: S, no file change. Shared pins: M                                         |
| 11 | Day separators and "jump to date"          | S    | —    | —        | Display only                                                                                    |
| 12 | Drafts kept after a restart                | S    | —    | —        | Local state per discussion and branch; today a draft is lost when the app closes                 |
| 13 | Code blocks and tables in messages         | M    | yes  | —        | New rich-text nodes; the editor, the sanitizer, and the plain-text rules must know them          |
| 14 | File attachments (PDF, DOCX, ZIP, …)       | L    | yes  | —        | The image part transport can carry them. Needs a size limit, an "open with" warning, and no automatic opening |

## Branches

| #  | Feature                                         | Size | File | Protocol | Notes                                                                    |
|----|-------------------------------------------------|------|------|----------|--------------------------------------------------------------------------|
| 15 | Branch map (a tree view of all branches)        | M    | —    | —        | Shows depth, state, and unread counts; click opens a branch              |
| 16 | Branch summary when a branch closes             | M    | yes  | yes      | The person who closes a branch writes a conclusion; the parent shows it   |
| 17 | Move a message to another branch                | L    | yes  | yes      | Hard with sync: the order and the read state of both branches change      |

## Synchronized discussions

| #  | Feature                                              | Size | File | Protocol | Notes                                                                                           |
|----|------------------------------------------------------|------|------|----------|-------------------------------------------------------------------------------------------------|
| 18 | Mute one discussion, and quiet hours                 | S    | —    | —        | Local settings for the notifications of release 1.4                                             |
| 19 | One list of new messages from all shared discussions | M    | —    | —        | In the tray menu or in a window; uses the notification data of release 1.4                       |
| 20 | Test and document OneDrive and Dropbox               | S    | —    | —        | The protocol works with any folder sync product; only Google Drive is tested                     |
| 21 | Same person on two computers                         | XL   | yes  | yes      | Today one key pair per Windows user. Needs device keys under one person and their own key changes |
| 22 | Merge of manually shared copies                      | XL   | —    | —        | In "Later, if required". Copies that were sent by hand have no event log, so a merge must guess   |

## Look, language, and accessibility

| #  | Feature                                    | Size | File | Protocol | Notes                                                                        |
|----|--------------------------------------------|------|------|----------|------------------------------------------------------------------------------|
| 23 | English user interface                     | M    | —    | —        | All texts are in `ru.ts` already; add a second file and a language setting   |
| 24 | Text size setting (zoom)                   | S    | —    | —        | Ctrl+plus and Ctrl+minus, kept in the settings                               |
| 25 | List of keyboard shortcuts (F1)            | S    | —    | —        | A dialog with the shortcuts that exist                                       |
| 26 | Screen reader check (NVDA, Narrator)       | M    | —    | —        | Roles, labels, and live regions for new messages; fixes as found              |

## Safety, delivery, and support

| #  | Feature                                         | Size | File | Protocol | Notes                                                                                        |
|----|-------------------------------------------------|------|------|----------|----------------------------------------------------------------------------------------------|
| 27 | Code signing of the installer                   | S    | —    | —        | Little work, but a yearly certificate cost. Removes the SmartScreen warning                   |
| 28 | Automatic local backups of each discussion file | M    | —    | —        | Keep the last N versions next to the local state; "Восстановить из резервной копии…"          |
| 29 | Recovery tool for a damaged file                | M    | —    | —        | In "Later, if required". Read the ZIP entries that are still good, write a new file            |
| 30 | Diagnostics: "Сохранить отчёт…"                 | S    | —    | —        | A ZIP of logs and sync state (no keys, no message text) that a person can send for support     |
| 31 | Beta channel for updates                        | S    | —    | —        | A setting that also accepts pre-releases on GitHub                                            |
| 32 | Independent security review                     | —    | —    | —        | Not development work, but it should come before more sync features                            |

## Not recommended

| Feature                          | Reason                                                                                     |
|----------------------------------|--------------------------------------------------------------------------------------------|
| Link previews                    | The app must fetch web pages. This breaks the "no network from the page" rule and leaks IP addresses |
| "Is typing…" and online status   | A shared folder syncs in seconds to minutes; the status would be wrong most of the time    |
| Voice and video                  | Out of scope in `requirements.md`; needs a server or peer-to-peer networking               |
| Cloud API (Google Drive API)     | Out of scope; the folder approach was chosen on purpose (ADR-002)                          |

## Questions before planning

- Q-1: Which three items do you want first?
- Q-2: Item 4 (leave or remove a member): must a removed member lose access to new messages only, or must the app
  also ask the others to stop showing the member's old messages? The app cannot take back what a member already has.
- Q-3: Item 7 (edit and delete): is "deleted" text kept in the history for the other members, or replaced with
  "Сообщение удалено" everywhere? Copies that were already synchronized keep the old text either way.
