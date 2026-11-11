# BranchChat — Product Requirements

**Status:** MVP requirements plus synchronized discussions (revision 12)  
**Technology:** Electron + TypeScript (see ADR-001)  
**Target platform:** Windows 10 and Windows 11  
**UI language:** Russian  
**Discussion exchange format:** One portable file per discussion  
**Application distribution:** One downloadable Windows `.exe` (per-user installer, no administrator rights)  
**Windows file association:** `.branchchat` opens in BranchChat  
**Application update source:** GitHub Releases; stable releases only

> Requirement numbers (FR-xxx, NFR-xxx) are stable identifiers, not an ordering. Requirements added after the first
> revision continue the existing numbering and appear in the section where they belong.

---

## 1. Product purpose

BranchChat is an offline-first Windows desktop application that looks and behaves like a familiar chat application,
while allowing users to branch a discussion from any selected passage in a message.

A participant selects text in a message and chooses **"Reply to this"**. The application creates a separate discussion
branch linked to the source message and the exact selected passage. A branch can itself contain messages from which
further branches can be created, with no artificial nesting limit.

Each discussion is stored in one portable file. Users can exchange this file through WhatsApp or another file-sharing
method. The recipient opens the file, continues the discussion, and sends the updated file back.

The application must work without a server, account, or internet connection. Internet access is required only for
checking and downloading application updates.

## 2. Product goals

1. Provide a familiar chat-like interface.
2. Allow users to create branches from selected message text.
3. Preserve the context that led to each branch.
4. Support nested branches.
5. Store an entire discussion, including who has read what, in one portable file.
6. Support rich-text formatting, links, and embedded images.
7. Work offline on Windows.
8. Support Russian, Cyrillic, and Unicode correctly.
9. Make file exchange straightforward for non-technical participants.
10. Make it easy to see which messages are new to the local user, and who has read the messages in a discussion.
11. Check GitHub Releases for stable application updates.
12. Provide a simple Windows deliverable: one downloadable `.exe`.
13. Allow discussion files to be opened by double-clicking them in Windows Explorer.

## 3. Out of scope for the MVP

- Server infrastructure and online user accounts.
- Concurrent editing of the same document file.
- Automatic merging or detection of independently edited copies (beyond the warning in FR-117). Synchronized
  discussions (section 5.12) merge events, not files.
- Automatic sending of messages through WhatsApp.
- Use of a cloud provider's API (Google Drive API, OAuth). A synchronized discussion uses only a local folder that a
  sync product keeps in sync (section 5.12).
- Support for operating systems other than Windows.
- Voice and video calls or audio messages.
- Editing or deleting sent messages.
- Save As / "save a copy" commands (users can copy the file in Explorer).
- Live read receipts for non-synchronized discussions (read information is only as current as the file the user
  has).

Revision 12 adds synchronized discussions (section 5.12). Real-time synchronization through a server, cryptographic
identity verification beyond the fingerprint check, and cloud storage of the discussion file itself stay out of scope.

The MVP and foreseeable product scope are Windows desktop only. Do not add cross-platform or mobile requirements unless
the product scope changes.

## 4. Main user scenarios

### 4.1. Create a discussion

1. The user launches BranchChat.
2. The user chooses **New discussion**.
3. BranchChat asks where to save the discussion file and creates it immediately.
4. BranchChat uses the participant name previously saved on that computer.
5. If no participant name has been saved, the application asks the user to enter one before the first message is sent.
6. The user writes and sends the first message.
7. The message is written to the discussion file as soon as it is sent. Every later change is saved the same way.

### 4.2. Continue a discussion

1. The user opens an existing discussion file.
2. The application displays the discussion in a chat-like interface.
3. Messages are shown in the order in which they were added to the thread. Each message displays its author and
   timestamp.
4. Messages written by other participants that the local participant has not yet read are clearly highlighted as
   unread (see section 5.10).
5. The user can mark a single message, a whole thread, or the whole discussion as read with an explicit button.
6. Each message shows which other participants have read it (see FR-122).
7. A message also becomes read when the user replies to it: by writing a message in the same thread, or by creating a
   branch from it with "Reply to this".
8. The user writes a message in the composer at the bottom of the chat.
9. The application saves the new message, and the updated read state, to the file.

### 4.3. Format a message

The user can format text using:

- Heading level 1.
- Heading level 2.
- Heading level 3.
- Bulleted lists.
- Numbered lists.
- Nested lists.
- Bold.
- Italic.
- Underline.
- Text color.
- Text background color.
- Hyperlinks.

Formatting must be preserved when the document is saved and reopened.

### 4.4. Create a branch from selected text

1. The user selects a continuous passage of text in a message. The message may be in the main thread, in a branch, or
   in the read-only inherited context of a branch.
2. A **"Reply to this"** action becomes available.
3. The user activates the action.
4. BranchChat creates a new branch linked to the original message and selected passage. The source message becomes
   read for the local participant.
5. The branch opens in the main chat area.
6. A side panel displays the branch hierarchy.
7. The new branch displays the relevant conversation history leading to the selected passage (see 4.5).
8. The selected passage is visually highlighted.
9. The user can write a reply in the new branch.
10. The branch can optionally have a user-defined title.

The branch must preserve the relationship to the original message and the selected passage.

### 4.5. Display context in a branch

A branch displays, as read-only inherited context, **all messages of its parent thread from the first message up to and
including the source message**. If the parent thread is itself a branch, the same rule is applied recursively, so the
full path from the main thread to the source message is shown.

- Messages that were added to the parent thread after the source message are not part of the context.
- Sibling branches are not included in the context.
- Inherited context is read-only. It must not be duplicated as newly authored messages in the branch.
- The selected passage must remain identifiable even if the original message contains formatting.
- The branch's own messages are shown after the inherited context.

### 4.6. Create nested branches

A user can select text inside a branch message and create another branch from it.

The new branch is linked to the message and branch from which it originated.

There is no artificial nesting-depth limit.

### 4.7. Close and reopen a branch

1. The user can mark a branch as closed.
2. Closed branches remain stored in the document.
3. The side panel separates active and closed branches.
4. The user can reopen a closed branch.
5. Closing a parent branch should not automatically close its child branches.
6. Branch status is maintained independently.

Closing a branch does not delete its content.

### 4.8. Exchange a discussion file

1. Every sent message, new branch, branch status change, title change, and read-state change is written to the file
   immediately; there is no separate "Save" step.
2. The user sends the document file through WhatsApp or another file-sharing method.
3. The recipient opens the file in BranchChat.
4. The recipient continues the discussion.
5. The recipient sends the updated file back.

Detecting or merging independently edited copies is not required. The only safeguard is the warning in FR-117.

### 4.9. Open a discussion file from Windows Explorer

1. The user double-clicks a BranchChat discussion file in Windows Explorer.
2. Windows launches BranchChat.
3. BranchChat opens the selected discussion file in its own window.
4. If BranchChat is already running, the file is passed to the running instance, which opens it in a new window (or
   focuses the existing window if that file is already open).

The application should provide a clear way to register and unregister the file association.

### 4.10. Update the application

1. BranchChat checks GitHub Releases for a newer stable version.
2. The check can happen in the background.
3. The user can also select **Help > Check for updates**.
4. The application displays the available version, release date, release notes, and download size.
5. The user can choose to download the update.
6. The application verifies the downloaded package using a cryptographic checksum (SHA-256 or stronger) when one is
   provided.
7. The update is applied using a safe replacement process, normally when the application is restarted.
8. Existing discussion files and user settings are preserved.

If the computer is offline or the update check fails, BranchChat must continue to work normally.

## 5. Functional requirements

### 5.1. Discussion document

- **FR-001.** Each discussion must be stored in one self-contained file.
- **FR-002.** The file must contain messages, threads, participants, timestamps, formatting, branch relationships,
  links, embedded images, and each participant's read state.
- **FR-003.** The application must support creating a new discussion.
- **FR-004.** The application must support opening an existing discussion.
- **FR-005.** The application saves changes automatically; there is no manual save command.
- **FR-006.** The application does not provide Save As. The discussion lives in the file chosen at creation or opened
  by the user.
- **FR-007.** Every sent message, created branch, branch status change, branch title change, and read-state change
  must be written to the discussion file immediately (autosave).
- **FR-008.** When the user closes a discussion window, the application must warn if there is an unsent non-empty
  draft or if the last write to the file failed. Unsent drafts are not saved to the document.
- **FR-009.** The application must show a useful error if a document is damaged or cannot be opened.
- **FR-010.** The document format must include a schema version.
- **FR-011.** The application must support document schema migrations where required.
- **FR-012.** The application must avoid corrupting documents created by newer unsupported versions. Files of schema
  version 1 are migrated to version 2 when opened (FR-151). Compatibility with version 1.0 of the application is not
  required (FR-151).
- **FR-013.** Saving must use a safe atomic-write strategy (write a temporary file, then replace the original).
- **FR-014.** The document should use a ZIP container with a manifest, discussion data, read state, and embedded
  assets.
- **FR-015.** Unknown optional fields should be preserved where practical.
- **FR-114.** The rich-text content of a message must be stored as structured, versioned data (not as raw HTML), so
  that it can be validated before display.
- **FR-117.** If a discussion is opened while another window already shows a file with the same `documentId` from a
  different path, the application must tell the user that two copies of the same discussion are open and which file
  is which. It must not merge them.

Proposed internal structure:

    discussion.branchchat
      manifest.json
      discussion.json
      readstate.json
      assets/
        images/
        attachments/

### 5.2. Participants and authorship

- **FR-016.** Every message must have an author.
- **FR-017.** The application must remember the participant name locally on each computer.
- **FR-018.** The application must not ask for the participant name every time a discussion is opened.
- **FR-019.** If no participant name is configured, the application must ask for one before the first message is sent.
- **FR-020.** Each participant must have a stable participant ID, generated once per computer and user profile and
  stored in local application settings. If those settings are lost, the same person will appear as a new
  participant; this is accepted for the MVP.
- **FR-021.** A participant ID must not be derived solely from the display name.
- **FR-022.** Participant ID and display name must be stored in the discussion document. A participant is added to the
  document the first time that participant writes to it (sends a message, creates a branch, or changes read state).
- **FR-023.** Different participants may have the same display name but must have different IDs.
- **FR-024.** Changing the local participant name must affect new messages only.
- **FR-025.** Participant identity is descriptive and is not intended to provide cryptographic authentication.

### 5.3. Chat interface

- **FR-026.** Messages must be displayed within a thread in the order of their logical clock (FR-152). For a
  discussion that is not synchronized this is the order in which they were added to the document. Timestamps are
  displayed but are not used for ordering, because computers' clocks can differ.
- **FR-027.** Each message must show its author.
- **FR-028.** Each message must show its timestamp.
- **FR-029.** The message composer must be located at the bottom of the active chat.
- **FR-030.** The interface must include a side panel for branch navigation.
- **FR-031.** The side panel must group active and closed branches.
- **FR-032.** The user must be able to navigate from a branch to its source message.
- **FR-033.** The user must be able to see the branch hierarchy.
- **FR-034.** The interface must remain usable for long discussions (see NFR-004).
- **FR-035.** The interface should indicate when a message has branches and how many.
- **FR-115.** Each discussion opens in its own window. Opening a file that is already open must bring the existing
  window to the front instead of opening a duplicate.

### 5.4. Message formatting

- **FR-036.** The editor must support heading levels 1–3.
- **FR-037.** The editor must support bulleted lists.
- **FR-038.** The editor must support numbered lists.
- **FR-039.** The editor must support nested lists.
- **FR-040.** The editor must support bold text.
- **FR-041.** The editor must support italic text.
- **FR-042.** The editor must support underlined text.
- **FR-043.** The editor must support text color.
- **FR-044.** The editor must support text background color.
- **FR-045.** The editor must support hyperlinks.
- **FR-046.** Formatting must be preserved when a discussion is saved and reopened.
- **FR-047.** Sent messages must not be editable.
- **FR-048.** Draft messages may be edited before sending.

### 5.5. Branching

- **FR-049.** The user must be able to select any continuous text passage in a message, including a passage that
  spans several formatting boundaries (for example bold, italic, link, and list item).
- **FR-050.** A "Reply to this" action must be available when a non-empty text selection exists.
- **FR-051.** A new branch must store a reference to the source message.
- **FR-052.** A new branch must store the selected passage as a quote.
- **FR-053.** The branch must display the inherited context defined in section 4.5.
- **FR-054.** The selected passage must be highlighted in the displayed context.
- **FR-055.** The branch must retain a durable reference to the source message and selected quote.
- **FR-056.** A branch may be created from a message in any existing thread, including from inherited context.
- **FR-057.** Branch nesting must not have an arbitrary application-imposed depth limit.
- **FR-058.** A branch title must be optional and user-defined.
- **FR-059.** A branch must have an Open or Closed status.
- **FR-060.** Closing a branch must not delete its content.
- **FR-061.** The application must display the branch path and hierarchy.
- **FR-062.** Inherited context must be read-only and must not be duplicated as authored messages.
- **FR-063.** Sibling branches must not automatically appear in the context of another branch.
- **FR-064.** Child branch status must be independent of parent branch status.
- **FR-126.** A closed branch takes no new messages. The composer is replaced by a notice with a button to reopen the
  branch. Branches can still be created from the messages of a closed branch, and its child branches are unaffected.
- **FR-127.** In the side panel, a branch is listed under its nearest ancestor that has the same status (Active or
  Closed). A branch whose real parent is in the other group is labelled with the name of that parent, so a closed
  parent never hides its open children.
- **FR-128.** Each thread keeps its own unsent draft while the user moves between branches. Closing the window warns if
  any thread has an unsent draft.

### 5.6. Images and links

- **FR-065.** The user must be able to paste an image from the clipboard or drag and drop it into a message draft.
- **FR-066.** Pasted images must be embedded in the discussion document.
- **FR-067.** The user must be able to add an image from a local file.
- **FR-068.** Images must be displayed inline in messages.
- **FR-069.** The user should be able to view an image at a larger size.
- **FR-070.** Image references must be stored in the discussion data and resolved from embedded assets.
- **FR-071.** The editor must support hyperlinks with a label and URL.
- **FR-072.** Plain URLs should be recognized as links where practical.
- **FR-073.** Links must be opened only after an explicit user action.
- **FR-074.** The application must not automatically fetch remote link content.
- **FR-075.** If an embedded asset is missing, the application must display a placeholder rather than fail to open the
  entire discussion.
- **FR-116.** Supported embedded image types are PNG, JPEG, GIF, and WebP. Other types, including SVG, are not
  accepted in the MVP.
- **FR-129.** An image added to a draft is stored in the discussion file only when a message containing it is sent. An
  image that is removed from the draft, or never sent, leaves no trace in the file. The same image (same content) is
  stored once, however many messages use it.
- **FR-130.** When pasting, if the clipboard contains both text and image data (as when copying cells from a
  spreadsheet), the text is pasted. If it contains only image data (a screenshot), the image is inserted.
- **FR-131.** An image whose data is missing from the file, does not match its recorded type or checksum, or cannot be
  displayed is shown as a placeholder (FR-075); the rest of the message and the discussion are unaffected.
- **FR-132.** Clicking an image opens a larger view that closes with Escape, with a close button, or with a click
  outside the picture.
- **FR-133.** An image is part of the message but not of its text: it does not change the position of text selections
  or the quote of a branch.

### 5.7. Language and text handling

- **FR-076.** The application interface must be in Russian.
- **FR-077.** The application must correctly support Cyrillic characters.
- **FR-078.** The application must correctly support the letters ё and Ё.
- **FR-079.** The application must support emoji and mixed-language text.
- **FR-080.** Text must be stored using UTF-8.
- **FR-081.** Timestamps must be stored in UTC and displayed in the local time zone.

### 5.8. Windows application delivery and file association

- **FR-082.** The primary deliverable is a single downloadable file, `BranchChat-Setup.exe`, a per-user installer that
  does not require administrator rights. A portable single-file `BranchChat.exe` is not required (see ADR-001 for the
  reasons).
- **FR-083.** The installer must bundle all runtime dependencies required on a supported Windows system.
- **FR-084.** Users must not need to install Java, Node.js, or any other runtime, configure environment variables, or
  start a local server.
- **FR-085.** If the installer approach proves impractical, the application should use the simplest self-contained
  Windows package (for example a portable ZIP folder) and document the reason.
- **FR-086.** The proposed discussion file extension is `.branchchat`.
- **FR-087.** Windows file association must allow double-clicking a `.branchchat` file in Explorer to launch BranchChat
  and open that discussion.
- **FR-088.** If BranchChat is already running, opening another discussion file must pass the file to the existing
  instance, which opens it according to FR-115.
- **FR-089.** The application must provide a clear way to register and unregister the file association (an option in
  the installer and a setting in the application; uninstalling removes it).
- **FR-090.** The application must not register the association without the user's consent, and must not silently
  take over an association that another application already holds.
- **FR-091.** The application must continue to support opening a discussion through File > Open.
- **FR-092.** Drag-and-drop opening should be supported where practical.
- **FR-118.** An invalid, missing, or inaccessible file path passed by Windows at launch must produce a clear error
  message and must not crash the application.
- **FR-134.** The installer has a "Файлы обсуждений" page with a checkbox "Открывать файлы .branchchat в BranchChat",
  ticked by default, that explains what it does and that it can be undone. The association is registered only if the
  box is ticked, for the current user only (no administrator rights).
- **FR-135.** Silent installs and automatic updates never show that page and never change the association: an update
  keeps whatever the person chose. Uninstalling removes the association, but not when it is only the first step of an
  update.
- **FR-136.** On first start the application asks, once, whether `.branchchat` files should open in BranchChat. It does
  not ask if the installer already asked, if the file type is already associated (with BranchChat or another program),
  or after any earlier answer. Any answer is remembered.
- **FR-137.** Explorer shows `.branchchat` files with the BranchChat document icon and the type name
  "Обсуждение BranchChat".
- **FR-138.** Settings (File > Settings…) shows whether the association is on, and switches it on or off. Switching it
  on
  is refused, with an explanation, if another program holds the file type or the person chose another program in
  Windows; BranchChat never takes the type over (FR-090). Settings also lets the person change their name; the new name
  applies to new messages only (FR-024).

### 5.9. Application updates

- **FR-093.** The application must check GitHub Releases for new stable versions.
- **FR-094.** Draft and prerelease versions must be ignored.
- **FR-095.** Update checks must run asynchronously and must not block normal application use.
- **FR-096.** The user must be able to initiate a manual check through Help > Check for updates.
- **FR-097.** Automatic update checks must be configurable.
- **FR-098.** The update dialog must show the available version, release date, release notes, and download size where
  available.
- **FR-099.** The user must be able to open the GitHub release page.
- **FR-100.** The application must download the correct Windows release artifact.
- **FR-101.** The application must verify a cryptographic checksum (SHA-256 or stronger) when one is published.
- **FR-102.** The application must not execute or install an update that fails verification.
- **FR-103.** The update process must preserve user settings.
- **FR-104.** The update process must not modify discussion documents.
- **FR-105.** Update failures must be reported without preventing normal offline use.
- **FR-106.** The update process must account for the fact that a running Windows executable cannot reliably replace
  itself.
- **FR-107.** A release should publish the Windows installer artifact and its checksum metadata.
- **FR-119.** Release artifacts are not code-signed in the MVP (see NFR-016). Update integrity relies on downloading
  from the official GitHub Release over HTTPS and on checksum verification (FR-101). If signing is added later, the
  application must also reject updates whose publisher signature does not match.

- **FR-139.** An update is downloaded only after the person asks for it ("Скачать" in the update dialog). A check never
  downloads anything.
- **FR-140.** An automatic check that finds a new version does not interrupt the person: it shows a small banner with
  "Подробнее" and a way to hide it. An automatic check that finds nothing, or fails (for example offline), shows
  nothing. Only a manual check always answers: new version, "the latest version is installed", or the reason it failed.
- **FR-141.** A downloaded update is installed when the person chooses "Перезапустить и установить", or silently the
  next time the application is closed normally. The silent install shows no installer pages and leaves the file
  association as it was (FR-135). Downgrades are never offered.
- **FR-142.** Release notes come from the internet and are shown as plain text only (markup is removed, never
  interpreted). Settings has an option to turn automatic checks off (default: on) and a "Проверить сейчас" button
  (FR-097).

### 5.10. Unread messages

Read state describes what each participant has seen. It is stored **in the discussion file**, so it travels with the
file when it is exchanged.

- **FR-108.** A message is *unread* for the local participant if it was authored by another participant and the local
  participant has not read it. Messages authored by the local participant are always read.
- **FR-109.** A message is *read* for a participant only if that participant's read state in the file says so. A
  participant who has never written to the file therefore sees all messages by others as unread.
- **FR-110.** Unread messages must be clearly and persistently highlighted in the chat view (for example with an
  accent bar and background), including in inherited context shown inside a branch.
- **FR-111.** The user must be able to mark a message as read with an explicit control on the message. The user must
  also be able to mark all messages of the current thread, or the whole discussion, as read. "Mark thread as read" marks
  the
  messages of that thread itself, not the inherited context shown in a branch (those belong to their own threads).
- **FR-112.** A message also becomes read for the local participant in exactly these two cases, in addition to FR-111:
    1. The local participant sends a message in a thread: every earlier message in that same thread becomes read.
    2. The local participant creates a branch from a message with "Reply to this": that source message becomes read.

  Scrolling, opening a thread, or viewing a message never marks it read.
- **FR-113.** The side panel must show the number of unread messages for each branch, and must show an indicator on a
  branch whose descendant branches contain unread messages. The window title or discussion header should show the
  total unread count. The window title starts with the total in parentheses, for example
  "(3) идея.branchchat — BranchChat".
- **FR-120.** Read state must be stored in the discussion file as a set of message IDs per participant ID. The
  application writes only the local participant's entry; entries of other participants must be preserved unchanged.
- **FR-121.** Read-state changes are saved immediately like other changes (FR-007) and must not alter any sent
  message.
- **FR-122.** Each message must show which other participants have read it, based on the read state in the file. The
  message's author is not listed, because an author has implicitly read their own message. A compact indicator is
  always visible on the message; the names are available on hover or click.
- **FR-123.** The indicator must distinguish three states: read by all other known participants, read by some, and read
  by none. "Known participants" are the participants listed in the document.
- **FR-124.** A person who has never written to the file is not a known participant and is therefore not shown as
  having read or not read anything. Read information reflects the file as last saved by each participant; it is not
  live. Once a person has changed their read state, they become a known participant (FR-022), so
  messages they have not read then show as not read by them. In a synchronized discussion, all members of the roster
  are known participants from the start (FR-163).
- **FR-125.** Because read status is visible to the other participants, the application must tell the user this with a
  one-time notice before the first write of a read-state change on that computer (for example when the first message
  is marked as read or sent), and the user guide must explain it.

### 5.11. Recent discussions and startup

- **FR-143.** The application remembers the discussions the person opened or created, most recent first. The list is
  local to the Windows user (like the settings) and is never stored in a discussion file.
- **FR-144.** The start screen (a window without a discussion) shows the list: file name, folder, and a button to
  remove the entry. Choosing an entry opens the discussion. A "Clear list" action empties the list. Neither removing
  an entry nor clearing the list touches the discussion files.
- **FR-145.** An entry whose file no longer exists is shown greyed out and marked "файл не найден". It stays in the list
  until the person removes it or newer files push it out. Choosing it shows the usual "file not found" message.
- **FR-146.** The number of remembered discussions is a setting (Settings, default 10, any whole number from 0; 0 keeps
  no list). Lowering it forgets the oldest entries immediately.
- **FR-147.** File > "Открыть недавние" and the taskbar jump list (category "Недавние") show the same list (the newest
  20 at most, because both are small surfaces; the start screen shows all remembered entries). Files that no longer
  exist are disabled in the menu and left out of the jump list. The menu also offers "Очистить список".
- **FR-148.** Setting "Открывать последнее обсуждение при запуске" is **on by default**, also for people who already
  had the application. When the application starts without a file and the most recent discussion still exists, that
  discussion opens instead of the empty start screen. If it does not exist, the start screen is shown.
- **FR-149.** A file passed on launch (double-click in Explorer, jump list, command line) always wins: only that file
  opens, the last discussion is not opened as well. The setting applies only to a plain start, not to a second launch
  that is forwarded to the running instance.
- **FR-150.** A problem with the list (unreadable `recent.json`, failed write, jump list unavailable) never prevents a
  discussion from opening; the list simply starts empty or is not updated.

### 5.12. Synchronized discussions

Source: `docs/01-future/google-drive-desktop-encrypted-chat-design.md` (revision 6), decisions D-01 to D-38. The wire
format is in `sync-protocol.md`. The release column says in which release the requirement is delivered.

#### Format and identity (release 1.1)

- **FR-151.** All discussion files use schema version 2. A version 1 file is migrated when it is opened and saved as
  version 2 at the next write. Version 1.0 of the application refuses version 2 files; this is accepted because there
  are no users of version 1.0 (D-03, D-28).
- **FR-152.** Every message and every thread has a logical clock (Lamport clock). Messages of a thread are ordered by
  (clock, author ID, message ID); `sequence` is the position after this order. A local change gets a clock one higher
  than every clock in the discussion, so in a discussion that is not synchronized the visible order is the order of
  writing (D-05).
- **FR-153.** Branch status and branch title record the clock and the participant of their last change. The change
  with the higher (clock, participant ID) wins (D-24).
- **FR-154.** A discussion file can contain the roster of a synchronized discussion (ZIP entry `sync.json`). A file with
  a roster that is not registered on this computer as a synchronized discussion opens as a normal discussion and keeps
  the roster unchanged (detached copy, D-06, D-26).
- **FR-155.** Each Windows user has one encryption identity: an Ed25519 signing key pair and an X25519 encryption key
  pair, bound to the participant ID (D-14). The keys are created on first use.
- **FR-156.** Private keys are stored only in the user's application data folder, encrypted with the Windows data
  protection of the user account (Electron `safeStorage`). They are never written to a discussion file, the shared
  folder, a log, or the window's page. If Windows data protection is not available, no keys are created and Settings
  says why.
- **FR-157.** Settings shows the key fingerprint (8 groups of 4 characters) and lets the person copy the public-key
  bundle as text or save it as a `.bckey` file (D-21).

#### Synchronized discussions (release 1.2)

- **FR-158.** File > "Новое общее обсуждение…", "Присоединиться к обсуждению…", and "Сделать обсуждение общим…"
  (for the open discussion) start wizards (D-20). An existing discussion can become synchronized; its full history
  goes to the members in the invitations (D-02).
- **FR-159.** A synchronized discussion uses a shared folder that a sync product (for example Google Drive for Desktop)
  keeps in sync. The application uses only the local path. It has no Google API, no OAuth, and no server (D-18).
- **FR-160.** The local `.branchchat` file of a synchronized discussion must be outside the shared folder. Only
  encrypted files are written to the shared folder (D-01). No temporary file is ever created there: each file is
  written completely on the local file system and then moved into the shared folder (D-39).
- **FR-161.** Every change (message, branch, branch status, branch title, read state, display name) is sent as a signed
  event, encrypted separately for each other member. Members apply the events to their local file, in any arrival
  order, and get the same discussion (D-04, D-05).
- **FR-162.** A member joins only by invitation. The person who invites checks the invitee's name and fingerprint and
  can discard a candidate key. The invitee checks the inviter's fingerprint. A member is active as soon as the
  invitation is imported (D-21, D-22, D-23).
- **FR-163.** All roster members are known participants for the read indicator, also before their first write (D-25).
- **FR-164.** A message for a branch that is closed on this computer is accepted; the branch stays closed (D-07).
- **FR-165.** Images and large messages travel as parts of at most 4 MB. While parts are missing, the message is shown
  at its place with a progress bar ("Загружается: N из M частей") and, where possible, its text with the placeholder
  "Изображение загружается…" for each missing image. Until all parts arrive, the message cannot be marked read, cannot
  be the source of a branch, and does not count as unread; its text can be selected and copied (D-10, D-30, D-31,
  D-37).
- **FR-166.** Settings has "Максимальный размер файла" for files in the shared folder: 5 MB to 1 000 MB, default 30
  MB. Larger files are not read (D-11, D-30).
- **FR-167.** "Отправить копию…" saves a copy of a synchronized discussion without the roster, for manual sharing. A
  copy made in Explorer is a detached copy (FR-154). Neither copy sends events (D-26).
- **FR-168.** If the registered file of a synchronized discussion is missing and a file with the same `documentId`
  is opened, the application asks "Это ваше общее обсуждение, которое было перемещено?". "Да" makes it the registered
  file (D-27).

#### Delivery marks and sync health (release 1.3)

- **FR-169.** In a synchronized discussion, the sender's own messages have one combined mark instead of the read
  indicator (D-09, D-40): one grey check when the message is written to the shared folder for all recipients; two grey
  checks when all recipients confirmed delivery; one green check when at least one member has read it; two green checks
  when all members have read it. A read state wins over a delivery state. The message details show per member:
  written, delivered, or read. Delivery is stored only on the sender's computer.
- **FR-170.** An unconfirmed copy is written again at start and every 30 minutes, but only if the recipient has shown
  activity since the last write (D-29).
- **FR-171.** Old files in the shared folder are cleaned up: receipts after 7 days, unconfirmed own files after 30
  days (D-19, D-34).
- **FR-172.** Sync problems (folder missing, no permission, invalid files, an update needed, key change requests) are
  shown in a status line in the window and in the tray menu. They do not raise Windows notifications (D-35).

#### Background sync (release 1.4)

- **FR-173.** When the last window closes and a synchronized discussion exists, the application stays in the
  notification area (tray) and keeps syncing. It shows a one-time notice the first time. "Выход" in the tray menu
  closes it (D-16, D-33).
- **FR-174.** "Запускать вместе с Windows" is turned on after the first synchronized discussion is created or joined;
  the wizard says so. The person can turn it off (D-36).
- **FR-175.** A new message from another member raises a Windows notification with the author, the discussion name, and
  up to 100 characters of the text (images as "[изображение]"). A loading message raises it only when it is complete.
  Settings: "Уведомления о новых сообщениях" (default on) and "Показывать текст в уведомлениях" (default on) (D-33,
  D-38).

#### Membership changes (release 1.5)

- **FR-176.** Any member can invite a new person into an active discussion. The other members accept the new member
  without a confirmation (D-13).
- **FR-177.** A person who lost the keys can be re-invited with the old participant ID. Each other member must accept
  the new keys after a fingerprint check; until then, events with the new keys wait and nobody encrypts to them. A
  member who rejects keeps the old keys, and both sides see a warning (D-15, D-32).

#### Not supported

- **FR-178.** Members cannot leave a synchronized discussion and cannot remove another member. There is no
  administrator after creation. There is no forward secrecy and no key backup (design, settled decisions).

## 6. Non-functional requirements

- **NFR-001.** The application must work offline for all discussion operations.
- **NFR-002.** The application must support Windows 10 and Windows 11.
- **NFR-003.** The interface must work at common Windows display scaling and DPI settings.
- **NFR-004.** The application must remain responsive with discussions containing thousands of messages and large
  embedded images. Long message lists must be virtualized so that not all messages are rendered at once.
- **NFR-005.** Saving must minimize the risk of document corruption.
- **NFR-006.** The discussion file must be portable between computers.
- **NFR-007.** The application must not require a remote service for normal use.
- **NFR-008.** Update checks may contact GitHub but must never transmit document content, participant names, or message
  text.
- **NFR-009.** Unknown optional document fields and unsupported schema versions must be handled without corrupting the
  file.
- **NFR-010.** Deliver the application as one downloadable Windows `.exe` that runs without requiring users to install
  a runtime or manage dependencies.
- **NFR-011.** Associate the discussion extension (proposed: `.branchchat`) with BranchChat. Double-clicking a document
  in Explorer must launch BranchChat and open that document. Provide a clear, consent-based way to register and
  unregister the association.
- **NFR-012.** If a single executable is impractical, use the simplest self-contained Windows package and explain the
  trade-off.
- **NFR-013.** The application must not depend on a running remote service for local document operations.
- **NFR-014.** *Untrusted input.* A received discussion file must be treated as untrusted. The application must:
  validate the document against its schema before displaying it; never render stored content as raw HTML or execute
  scripts from it; reject ZIP entries with unsafe paths (path traversal); read ZIP entries as streams and reject any
  entry whose actual size does not match its declared size; validate that embedded images are of a supported type;
  and open links only if the protocol is `http`, `https`, or `mailto`.
- **NFR-015.** *No artificial limits.* The application must not impose fixed limits on the number of messages, message
  length, number of branches, branch depth, image size, or file size. Practical limits come only from the computer's
  resources.
- **NFR-016.** *Code signing.* Releases are not code-signed in the MVP. The release notes, the README, and the user
  guide must explain the Windows SmartScreen warning ("More info", then "Run anyway"), say that the installer must be
  downloaded only from the official GitHub Release, and publish the installer's SHA-256 checksum so it can be checked
  manually. Code signing may be added in a later release without changing the product.
- **NFR-017.** *Local data.* Settings (participant name and ID, update preferences) are stored per Windows user in the
  user's application data folder, not next to the executable, and survive updates.

## 7. Proposed data model

This is a conceptual model, not a final implementation schema.

### Discussion

- `documentId` — unique document identifier.
- `title` — discussion title.
- `schemaVersion` — document schema version.
- `createdAt` — creation timestamp.
- `updatedAt` — last modification timestamp.
- `participants` — participants known to this discussion.
- `threads` — main thread and branches.
- `assets` — embedded images (each identified by the SHA-256 of its content, so identical images are stored once).
- `readState` — read message IDs per participant (stored as a separate entry in the ZIP).

### Participant

- `participantId` — stable participant identifier.
- `displayName` — participant name.

### Message

- `messageId` — unique message identifier.
- `threadId` — thread containing the message.
- `sequence` — position of the message in its thread after ordering by clock (FR-152).
- `clock` — logical clock of the message (schema version 2, FR-152).
- `authorId` — participant who authored the message.
- `authorDisplayName` — the author's display name at the time the message was written (so that renaming a participant
  affects new messages only, FR-024).
- `createdAt` — timestamp (UTC), for display.
- `content` — structured rich-text content in a versioned format (not HTML).
- `assetReferences` — references to embedded assets.

Sent messages are immutable.

### Thread / Branch

- `threadId` — unique thread identifier.
- `parentThreadId` — parent thread, if this is a branch.
- `sourceMessageId` — message from which the branch originated.
- `quoteText` — selected source passage.
- `selectionStart` and `selectionEnd` — selection range within the source message, as offsets (UTF-16 code units) in
  the message's plain text: text nodes concatenated, a hard break is one newline, and every paragraph or heading is
  followed by one newline (trailing newlines at the very end are dropped). This does not depend on the editor or on how
  the message is displayed.
- `title` — optional branch title.
- `status` — Open or Closed.
- `createdAt` — creation timestamp.
- `createdBy` — participant who created the branch.
- `clock` — logical clock of the branch; `statusSet` and `titleSet` — clock and participant of the last status and
  title change (schema version 2, FR-152, FR-153).

Because sent messages are immutable, the selection range stays valid for the life of the message. The source message ID
and stored quote text remain the durable reference; the range is used to highlight the passage and may be ignored if it
no longer matches the quote.
The quote stored with a branch is always taken from the stored message by the application's main process, never from
what the window reports.

### Read state

- `readState[participantId]` — list of `messageId` values that participant has read.
- Messages authored by a participant are implicitly read by that participant and are not listed.
- Because it is part of the file, other participants' applications show which messages a participant has read
  (FR-122). Participants are informed of this (FR-125).

### Roster (synchronized discussions only, ZIP entry `sync.json`)

- `protocolVersion` and `members[]`: participant ID, display name, public signing and encryption keys, fingerprint,
  who added the member, and previous keys (FR-154). Never private keys.

### Local state (not stored in the discussion file)

- Participant name and participant ID.
- Application settings, including update preferences.

## 8. Architecture principles

The architecture must separate:

1. Presentation layer.
2. Domain model and branching logic.
3. Document persistence and ZIP handling.
4. Embedded asset management.
5. Local state (settings).
6. Windows integration.
7. Application update mechanism.

The technology is recorded in ADR-001 (Electron + TypeScript). The domain model and document format must not depend on
the UI framework, the desktop shell, or the packaging tool.

Avoid introducing a local HTTP server unless it provides a clear benefit.

## 9. Acceptance criteria

The MVP is acceptable when:

1. A user can create a discussion.
2. A discussion is saved automatically and can be reopened.
3. A discussion file can be sent to another user.
4. The recipient can open and continue the discussion.
5. Every message displays its author and timestamp.
6. The local participant name is remembered.
7. The required formatting is supported.
8. Images can be pasted from the clipboard.
9. Images remain available after the document is moved to another computer.
10. Links can be opened by an explicit user action.
11. Selecting text exposes the "Reply to this" action, including for selections spanning formatting boundaries.
12. A branch preserves its source message and selected quote.
13. A branch displays the relevant preceding conversation history as defined in section 4.5.
14. Nested branches work.
15. The branch side panel distinguishes active and closed branches.
16. Closed branches can be reopened.
17. The application works without internet access.
18. The application can check for stable GitHub Releases.
19. The update process does not modify discussion documents.
20. The application can be launched through a `.branchchat` file association, including when it is already running.
21. The application can be installed from a single `.exe` on a clean Windows 10/11 machine without installing any other
    runtime.
22. Unread messages from other participants are clearly highlighted; they can be marked as read individually or in
    bulk; replying in a thread or with "Reply to this" marks the relevant messages read; the side panel shows
    per-branch unread counts; the read state persists in the file when it is sent to another user and returned; each
    message shows who has read it; and the user is told once that read status is visible to others.
23. A deliberately malformed or malicious discussion file is rejected or displayed safely without running code.
24. The release notes and user guide explain the SmartScreen warning and how to proceed, and publish the installer's
    checksum.

## 10. Confirmed product decisions

| Topic                                | Decision                                                                           |
|--------------------------------------|------------------------------------------------------------------------------------|
| Target platform                      | Windows 10 and Windows 11                                                          |
| Technology                           | Electron + TypeScript                                                              |
| UI language                          | Russian                                                                            |
| Discussion format                    | One portable file per discussion                                                   |
| Discussion file container            | ZIP                                                                                |
| Main interface                       | Chat-like                                                                          |
| Saving                               | Automatic; no manual Save and no Save As                                           |
| Branch navigation                    | Side panel                                                                         |
| Branch groups                        | Active and Closed                                                                  |
| Branch closing                       | Branches can be closed and reopened                                                |
| Branch context                       | Parent-thread messages up to and including the source message, recursive           |
| Message order                        | Append order, not timestamp                                                        |
| Nested branches                      | Supported                                                                          |
| Sent message editing                 | Not allowed                                                                        |
| Message deletion                     | Not allowed                                                                        |
| Branch deletion                      | Not allowed                                                                        |
| Merge of independently edited copies | Not required for MVP                                                               |
| Images                               | Supported, including clipboard paste; embedded in document                         |
| Links                                | Supported; http, https, mailto only                                                |
| Participant name                     | Remembered locally on each computer                                                |
| Participant identity                 | Stable local ID; display name is not an identity guarantee                         |
| Unread messages                      | Highlighted; read state stored in the file; read by explicit action or by replying |
| Read status of others                | Shown on every message; read-only; as current as the file                          |
| Limits                               | No artificial limits                                                               |
| Windows per document                 | One window per discussion; one application instance                                |
| Application distribution             | Single per-user installer `.exe`                                                   |
| File association                     | Double-clicking `.branchchat` opens BranchChat                                     |
| Code signing                         | Not in the MVP; SmartScreen warning documented                                     |
| Updates                              | GitHub Releases, stable releases only                                              |
| Other platforms                      | Out of scope                                                                       |

## 11. Priorities

### MVP

- Windows desktop application.
- Create, open, and exchange discussion files with automatic saving.
- Chat-like message interface.
- Participant names and authorship.
- Unread message highlighting, "mark as read", and read-on-reply.
- Display of which participants have read each message.
- Rich-text formatting.
- Branch creation from selected text.
- Relevant inherited context.
- Nested branches.
- Branch side panel and status.
- Embedded images.
- Hyperlinks.
- Offline operation.
- Safe handling of untrusted discussion files.
- Simple Windows distribution (single installer `.exe`, unsigned, with the SmartScreen warning documented).
- `.branchchat` file association.
- GitHub stable-release update checks.

### Later, if required

- Additional export formats.
- More advanced search.
- Improved branch filtering.
- Additional document recovery tools.
- Detection and merging of divergent copies (synchronized discussions, section 5.12, cover the shared case).
- Further usability improvements.

No mobile or non-Windows client is currently planned.

## 12. Open items

None at present.

## 13. Summary

BranchChat is a Windows-only, offline-first discussion application. Its defining feature is the ability to branch a
conversation from an exact selected passage while preserving the relevant preceding context.

Each discussion is a portable file that can be exchanged through ordinary file-sharing tools. The file also records
which messages each participant has read, so unread highlighting continues correctly after the file is exchanged and
every message shows who has read it.

The application is distributed as a single installer `.exe` that needs no administrator rights and no separate runtime.
Windows file association allows users to open discussion files by double-clicking them in Explorer.

## Changes in revision 12

- Synchronized discussions (section 5.12, FR-151 to FR-178), from the design document revision 6. Schema version 2
  for all files; order by logical clock (FR-026 changed); roster members are known participants (FR-124 changed);
  version 1 files are migrated (FR-012 changed). Out-of-scope list updated.

## Changes in revision 11

- Recent discussions and startup (FR-143 to FR-150): list on the start screen, File menu and jump list; configurable
  size; missing files greyed out; reopening the last discussion at startup (on by default).

## Changes in revision 10

- Phase 9 (hardening and release) added no new product behavior. Clarifications: NFR-003 is verified for Windows
  display scaling 100–200 %, the smallest window, keyboard use, focus handling and Windows high-contrast themes;
  spell check uses the operating-system spell checker for Russian and English (no bundled dictionary); releases are
  made only by the tag-triggered CI workflow and always include a SHA-256 (NFR-016, FR-119).

## Changes in revision 9

- Updates (phase 8): what an update check and download may and may not do (FR-139 to FR-142).

## Changes in revision 8

- Windows integration (phase 7): the installer page and its rules (FR-134, FR-135), the first-start question
  (FR-136), icon and type name (FR-137), and Settings (FR-138).

## Changes in revision 7

- Images (phase 6): staged in the draft and stored only when sent (FR-129), paste rules (FR-130), placeholders for
  damaged data (FR-131), the larger view (FR-132), and images not affecting text offsets (FR-133).

## Changes in revision 6

- "Mark thread as read" covers the thread's own messages only (FR-111).
- The window title shows the unread total (FR-113).
- Clarified that a person becomes a known participant after their first read-state change (FR-124).

## Changes in revision 5

- Closed branches take no new messages until reopened (FR-126). This was not specified before; reopening is one click.
- Side panel grouping rule for a closed parent with open children (FR-127); per-thread drafts (FR-128).
- The selection range of a branch is defined as offsets in the message's plain text (data model).
- The quote is taken from the stored message by the main process.

## Changes in revision 4

- Other participants' read status is now part of the MVP: every message shows who has read it (FR-122 to FR-124), with
  a one-time privacy notice (FR-125). Removed it from out-of-scope and "later" lists.
- Code signing is decided: releases are unsigned in the MVP (NFR-016, FR-119, acceptance criterion 24). The open items
  list is now empty.
