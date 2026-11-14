# BranchChat: requirements for release 2

**Status:** Draft 2 (answers of draft 1 applied; three new questions in Section 5)  
**Date:** 2026-11-14  
**Base:** `requirements.md` (revision 13) stays valid. This document adds requirements; where it changes an earlier
requirement, it says so.  
**Source:** the filtered list of `feature-ideas.md`; the storage decision is in `adr-003-local-storage.md`.

Numbering: functional requirements FR-201 and up, non-functional requirements NFR-201 and up. The number in brackets
after each title is the item number in `feature-ideas.md`.

Size: S 1–2 days, M 3–7 days, L 1–3 weeks, XL more than 3 weeks (one developer, with tests and documents).

---

## 1. Summary

| Area | Feature                           | Item | Size | File format | Sync protocol |
|------|-----------------------------------|------|------|-------------|---------------|
| 2.1  | Local storage, export and import  | ADR  | L    | —           | —             |
| 2.2  | Search in a discussion            | 1    | M    | —           | —             |
| 2.3  | Several discussions in one window | 3    | L    | —           | —             |
| 2.4  | Reactions                         | 8    | M    | yes         | yes           |
| 2.5  | Day separators and "jump to date" | 11   | S    | —           | —             |
| 2.6  | Drafts kept after a restart       | 12   | S    | —           | —             |
| 2.7  | File attachments                  | 14   | L    | yes         | —             |
| 2.8  | Branch map                        | 15   | M    | —           | —             |
| 2.9  | Same person on two computers      | 21   | XL   | yes         | yes           |
| 2.10 | English user interface            | 23   | M    | —           | —             |
| 2.11 | Text size                         | 24   | S    | —           | —             |
| 2.12 | List of keyboard shortcuts        | 25   | S    | —           | —             |
| 2.13 | Log file and diagnostics report   | 30   | S    | —           | —             |

"File format" means a new schema version of the `.branchchat` file (export format) is needed. Older versions must
refuse such a file with the existing "made by a newer version" message (FR-016).

## 2. Functional requirements

### 2.1 Local storage, export and import (ADR-003)

ADR-003 is accepted: option C, variant C1 (a local SQLite library; `.branchchat` only for export and import).

- **FR-201.** BranchChat stores all discussions of a Windows user in a local library in `%APPDATA%\BranchChat`: a
  SQLite database (WAL mode) and a `blobs` folder with images and attachments, one file per content hash. A change (a
  message, a read mark, a status) writes only the changed data. The write time does not grow with the number of
  messages or images.
- **FR-202.** A write is atomic: after a crash or a power cut, the library has the state before or after the change,
  never a mix.
- **FR-203.** "Экспортировать…" writes a discussion as a `.branchchat` file in the current export format, with all
  images and attachments. The file passes the same validation as an imported file. This replaces "Отправить копию…"
  (FR-170): a synchronized discussion is exported without sync data.
- **FR-204.** "Импортировать…", drag and drop, and a double-click on a `.branchchat` file import a discussion, then
  open it. Import validates the file as today (FR-125), migrates older schema versions, and never changes the file.
- **FR-205.** The import of a discussion that is already in the library (same document ID) merges: new messages,
  branches, participants, images, and read marks are added; nothing is removed; for branch titles and states the later
  change wins (ADR-003, "Merge on import"). The import says how many messages it added. A synchronized discussion
  follows Q-11.
- **FR-206.** At the first start of the new version, BranchChat shows one question with the known files (recent list,
  sync registry), all selected. Each selected file is imported. Synchronized discussions keep their roster, keys, and
  sync state. The original files are not deleted.
- **FR-207.** BranchChat makes a backup of the library once a day and before each change of the library schema: in
  `%APPDATA%\BranchChat\backups` and, if set, in a folder that the person chooses in Settings (for example in
  Documents or a cloud folder). Each place keeps the last 7 backups. "Резервная копия сейчас" makes one at once.
  "Восстановить из резервной копии…" restores a backup after a confirmation; the current library is kept as a backup
  first.
- **FR-209.** Settings show that backups contain the messages without encryption, and that the private keys are not in
  a backup.
- **FR-208.** At start, BranchChat checks the library. If it is damaged, BranchChat says so and offers the last good
  backup. It never deletes a damaged library.
- Changes to earlier requirements: FR-007 and FR-013 (save to the file on each change) apply to the library; FR-117
  (copy changed elsewhere), FR-154 (detached copy), and FR-168 (moved file) do not apply to library discussions.

### 2.2 Search (1)

- **FR-211.** Ctrl+F (and a search button) opens a search field in the discussion. The search finds messages in all
  branches, open and closed.
- **FR-215.** Ctrl+Shift+F (and a field above the discussion list) searches in **all** discussions of the library.
  Results are grouped by discussion; a click opens the discussion, the branch, and the message.
- **FR-212.** The search ignores case, treats ё and е as the same letter, and finds words that start with the search
  text ("ёжик" finds "ёжика").
- **FR-213.** Results show the author, the time, the branch, and the text around the match. Enter and Shift+Enter (or
  arrows) go to the next and the previous result; the window opens the branch and highlights the match.
- **FR-214.** The search reads the text of messages, branch titles, and file names of attachments; not the text inside
  images or attachments.
- **NFR-201.** A search in a discussion of 20,000 messages, or in a library of 100,000 messages, shows the first
  results in less than 0.5 s.

### 2.3 Several discussions in one window (3)

- **FR-221.** The window has a list of discussions on the left: name, time of the last message, number of unread
  messages, and a mark for synchronized discussions. A click opens the discussion in the same window.
- **FR-222.** The list can be sorted by the last message (default) or by name, and filtered by text.
- **FR-223.** The list can be hidden to give the discussion the whole width. The width and the state are kept.
- **FR-224.** A discussion keeps its position (branch, scroll) when the person switches to another one and back.
- **FR-225.** There is one main window. "Открыть в новом окне" in the list opens a discussion in a separate window
  (for example to see two side by side). A discussion that is open in a window is not opened a second time; its window
  comes to the front.
- Change: the "recent files" list (section 5.11) becomes this list.

### 2.4 Reactions (8)

- **FR-231.** A person can add a reaction to any message: one of 👍 👎 ❤️ 😂 😮 😢 ✅. A second click on the same
  reaction removes it. A person can give several different reactions to one message.
- **FR-232.** Under the message, each reaction shows the emoji and the count; a mouse-over shows who reacted.
- **FR-233.** Reactions are stored in the discussion and exported. In a synchronized discussion, reactions are
  synchronized with a new event; the last change of a person wins for each emoji (as for statuses, D-05).
- **FR-234.** A reaction does not make a message unread and does not raise a notification.

### 2.5 Day separators and "jump to date" (11)

- **FR-241.** The message list shows a separator with the date between messages of different days (local time):
  "Сегодня", "Вчера", or the date.
- **FR-242.** "Перейти к дате…" opens a calendar. The days with messages in the current branch are marked. The
  choice scrolls to the first message of that day.

### 2.6 Drafts kept after a restart (12)

- **FR-251.** A draft (text and images) is kept for each discussion and branch, also after the app closes or the
  computer restarts.
- **FR-252.** Drafts are local. They are not in an export and not synchronized.
- **FR-253.** The discussion list (FR-221) marks discussions with a draft.
- **FR-254.** The question about unsent drafts when a window closes (today) is no longer needed and is removed.

### 2.7 File attachments (14)

- **FR-261.** A person can attach files to a message: with a button, drag and drop, or paste. Images keep their
  current behavior.
- **FR-262.** A message shows each attachment with the file name, the size, and an icon. "Сохранить как…" saves a
  copy. "Открыть" saves the file to a temporary folder and opens it with Windows.
- **FR-267.** Before "Открыть", BranchChat warns for files that can run code: `.exe`, `.bat`, `.cmd`, `.ps1`, `.js`,
  `.vbs`, `.msi`, `.lnk`, `.docm`, `.xlsm`. The warning names the type and the author. No type is blocked; the person
  decides. The list is part of the app (not a setting).
- **FR-263.** A saved or opened file gets the Windows "downloaded from the internet" mark (Mark of the Web), so Windows
  and Office apply their protections.
- **FR-264.** BranchChat never opens or runs an attachment by itself.
- **FR-265.** The largest attachment is a setting: "Наибольший размер вложения", default 100 MB. A larger file is
  refused with a message that names the limit. In a synchronized discussion, attachments travel in parts, as images
  do (D-30), and the receiver's file size limit of FR-166 also applies (Q-12).
- **FR-266.** Attachments are stored by content hash; the same file attached twice is stored once.

### 2.8 Branch map (15)

- **FR-271.** "Карта веток" shows all branches of the discussion as a tree: title, state (open or closed), number of
  messages, and number of unread messages.
- **FR-272.** A click on a branch opens it. The current branch is marked.
- **FR-273.** The map can show only open branches, or branches with unread messages.

### 2.9 Same person on two computers (21) — later, not in release 2

Decision (Q-10): not in release 2. This item needs its own design document before requirements can be final. The
points below are the goals only.

- **FR-281.** A person can use the same identity on two or more computers. Messages written on one computer appear on
  the others as the same author.
- **FR-282.** The read state belongs to the person, not to the computer.
- **FR-283.** A computer is added with a check of both computers (for example a code shown on one and typed on the
  other), and it can be removed. A removed computer gets no new messages.
- **FR-284.** Losing one computer does not need the re-invitation of FR-177 if another computer of the person is still
  available.

### 2.10 English user interface (23)

- **FR-291.** All texts of the interface exist in Russian and English: menus, dialogs, errors, notifications, the tray
  menu, and the installer.
- **FR-292.** Settings have "Язык / Language". The default is Russian, whatever the Windows language is.
- **FR-293.** A change of the language applies after a restart of the app; Settings offer "Перезапустить сейчас".
- **FR-294.** Documents do not change: the documents in `docs/` stay in English, and the user guide stays in Russian
  (an English user guide is separate work).
- **FR-295.** Text in discussions is never translated.

### 2.11 Text size (24)

- **FR-301.** Ctrl+plus, Ctrl+minus, and Ctrl+0 change the text size of the whole window from 80 % to 200 %, in steps
  of 10 %. Ctrl+mouse wheel does the same.
- **FR-302.** The size is kept in the settings and shown in Settings, with a reset button.

### 2.12 List of keyboard shortcuts (25)

- **FR-311.** F1 and "Справка > Сочетания клавиш" show all keyboard shortcuts, grouped (messages, branches, window).
- **FR-312.** The list is made from the same data that the app uses for its shortcuts, so it is always complete.

### 2.13 Log file and diagnostics report (30)

- **FR-321.** BranchChat writes a log file in `%APPDATA%\BranchChat\logs`: start, errors, sync, updates. The size is
  limited (for example 5 files of 2 MB).
- **FR-322.** The log contains no message text, no names of discussions, no keys, and no file contents. File paths and
  participant IDs are allowed.
- **FR-323.** "Справка > Сохранить отчёт…" saves a ZIP with the log files, the app version, the Windows version, the
  settings without the name, and the sync state without keys. The dialog shows what is in the report, and says that
  file paths can contain the Windows user name.
- **FR-324.** A log write error never stops the app (see the EPIPE fix of 2026-11-14).

## 3. Non-functional requirements

- **NFR-202.** Sending a message in a discussion of 20,000 messages and 1 GB of images: saved in less than 0.1 s.
- **NFR-203.** Opening a discussion of 20,000 messages: the first messages visible in less than 1 s.
- **NFR-204.** Import and export of a discussion of 20,000 messages without images: less than 5 s each.
- **NFR-205.** All new texts follow the existing rules: interface texts in `ru.ts` and `en.ts`, no text in code. A
  test checks that both files have the same keys.
- **NFR-206.** All new features work with the keyboard and with Windows high-contrast themes, as today.

## 4. Proposed order

| Step | Content                                                           | Why first                                                        |
|------|-------------------------------------------------------------------|------------------------------------------------------------------|
| 1    | 2.13 log file, 2.11 text size, 2.12 shortcuts, 2.5 day separators | Small, independent, useful at once                               |
| 2    | 2.1 local storage (after ADR-003 is accepted)                     | Search, the discussion list, drafts, and attachments build on it |
| 3    | 2.6 drafts, 2.2 search, 2.3 several discussions                   | Use the library                                                  |
| 4    | 2.8 branch map, 2.4 reactions                                     | Reactions need a new file schema and sync event                  |
| 5    | 2.7 file attachments                                              | New file schema; security review of opening files                |
| 6    | 2.10 English interface                                            | Best after the texts of steps 1–5 are written                    |
| —    | 2.9 same person on two computers                                  | Later, not in release 2 (Q-10)                                   |

## 5. Questions

**Q-01.** Accept ADR-003 (local library, `.branchchat` for export and import)? Answer the questions of ADR-003 first.

**Answer:** Option C (a local SQLite library with `node:sqlite`; `.branchchat` ZIP for export and import).

**Q-02.** Search (2.2): is a search across **all** discussions needed in release 2 (simple with the library), or only
inside the open discussion?

**Answer:** yes

**Q-03.** Several discussions (2.3): one window only, or may the person still open a discussion in a second window
(for example to see two side by side)? Recommendation: one main window, and "Открыть в новом окне" in the list.

**Answer:** as recommended

**Q-04.** Reactions (2.4): which emoji? Recommendation: 👍 👎 ❤️ 😂 😮 😢 ✅. Or any emoji from a picker?

**Answer:** recommended

**Q-05.** Attachments (2.7): the largest file? Recommendation: 100 MB per file, and the sync limit (FR-166) for
synchronized discussions.

**Answer:** as recommended. make it configurable

**Q-06.** Attachments (2.7): which files get a warning before "Открыть" (for example `.exe`, `.bat`, `.cmd`, `.ps1`,
`.js`, `.vbs`, `.msi`, `.lnk`, `.docm`, `.xlsm`)? Must some types be blocked completely, or only warned?

**Answer:** only warnings. all in example

**Q-07.** Language (2.10): the default when Windows has another language than Russian or English (for example
Latvian): English? And may a language change need a restart of the window?

**Answer:** ok to require restart. use always russian by default.

**Q-08.** Language (2.10): must the documents in `docs/` (in English now) and the user guide (Russian now) exist in
both languages, or only the user guide?

**Answer:** no need to adjust user guide. it will be done separately. all docs stay as they are.

**Q-09.** Diagnostics (2.13): may the log contain file paths (they can contain the person's Windows name) and
participant IDs? Recommendation: yes, and the report dialog says so.

**Answer:** yes

**Q-10.** Two computers (2.9): is this needed in release 2, or later after a separate design? Recommendation: later; it
is the largest and the riskiest item.

**Answer:** keep it later.

**Q-11 (new).** Import into a synchronized discussion: see ADR-003 Q-08. Recommendation: refuse the import; the shared
folder is the only source of a synchronized discussion.

**Answer:** refuse the import

**Q-12 (new).** Attachments in a synchronized discussion: the sender's limit (default 100 MB) can be larger than a
receiver's file size limit (FR-166, default 30 MB). Then the receiver never gets the file. Should the sender see a
warning before sending an attachment larger than 30 MB in a synchronized discussion ("некоторые участники могут не
получить файл")? Recommendation: yes.

**Answer:**  should we add this value in synchronized chat metadata? then sender knows other users size limit upfront.

**Q-13 (new).** Backups: the folder of the person can be a cloud folder. A backup contains all messages without
encryption. Should the app encrypt the backup in the person's folder (a passphrase), or only warn? Recommendation:
only warn in release 2; encrypted backups together with the key backup (`feature-ideas.md`, item 2) later.

**Answer:** warn only

