# BranchChat — Product Requirements

**Status:** MVP requirements (revision 4)  
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

- Real-time synchronization.
- Server infrastructure and online user accounts.
- Concurrent editing of the same document.
- Automatic merging or detection of independently edited copies (beyond the warning in FR-117).
- Automatic sending of messages through WhatsApp.
- Cloud storage of discussions.
- Support for operating systems other than Windows.
- Voice and video calls or audio messages.
- Cryptographic identity verification.
- Editing or deleting sent messages.
- Save As / "save a copy" commands (users can copy the file in Explorer).
- Live read receipts (read information is only as current as the file the user has).

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
- **FR-012.** The application must avoid corrupting documents created by newer unsupported versions.
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

- **FR-026.** Messages must be displayed within a thread in the order in which they were added to the document. This
  append order is authoritative; timestamps are displayed but are not used for ordering, because computers' clocks
  can differ.
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
  also be able to mark all messages of the current thread, or the whole discussion, as read.
- **FR-112.** A message also becomes read for the local participant in exactly these two cases, in addition to FR-111:
    1. The local participant sends a message in a thread: every earlier message in that same thread becomes read.
    2. The local participant creates a branch from a message with "Reply to this": that source message becomes read.

  Scrolling, opening a thread, or viewing a message never marks it read.
- **FR-113.** The side panel must show the number of unread messages for each branch, and must show an indicator on a
  branch whose descendant branches contain unread messages. The window title or discussion header should show the
  total unread count.
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
  live.
- **FR-125.** Because read status is visible to the other participants, the application must tell the user this with a
  one-time notice before the first write of a read-state change on that computer (for example when the first message
  is marked as read or sent), and the user guide must explain it.

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
- `assets` — embedded images and other resources.
- `readState` — read message IDs per participant (stored as a separate entry in the ZIP).

### Participant

- `participantId` — stable participant identifier.
- `displayName` — participant name.

### Message

- `messageId` — unique message identifier.
- `threadId` — thread containing the message.
- `sequence` — position of the message in its thread (append order; authoritative for display order).
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
- `selectionStart` and `selectionEnd` — selection range within the source message's content model.
- `title` — optional branch title.
- `status` — Open or Closed.
- `createdAt` — creation timestamp.
- `createdBy` — participant who created the branch.

Because sent messages are immutable, the selection range stays valid for the life of the message. The source message ID
and stored quote text remain the durable reference; the range is used to highlight the passage and may be ignored if it
no longer matches the quote.

### Read state

- `readState[participantId]` — list of `messageId` values that participant has read.
- Messages authored by a participant are implicitly read by that participant and are not listed.
- Because it is part of the file, other participants' applications show which messages a participant has read
  (FR-122). Participants are informed of this (FR-125).

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
- Detection and merging of divergent copies.
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

## Changes in revision 4

- Other participants' read status is now part of the MVP: every message shows who has read it (FR-122 to FR-124), with
  a one-time privacy notice (FR-125). Removed it from out-of-scope and "later" lists.
- Code signing is decided: releases are unsigned in the MVP (NFR-016, FR-119, acceptance criterion 24). The open items
  list is now empty.
