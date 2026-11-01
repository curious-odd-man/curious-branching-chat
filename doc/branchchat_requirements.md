# TODO

- add requirement about unread messages clearly visible and button to mark as read

# BranchChat — Product Requirements

**Status:** MVP requirements  
**Target platform:** Windows 10 and Windows 11  
**Current project stack:** JavaFX + Spring Boot + Gradle (subject to architecture decision)  
**UI language:** Russian  
**Discussion exchange format:** One portable file per discussion  
**Application distribution:** Preferably a single self-contained Windows `.exe`  
**Windows file association:** Associate the discussion file type with BranchChat  
**Application update source:** GitHub Releases; stable releases only

---

## 1. Product purpose

BranchChat is an offline-first Windows desktop application that looks and behaves like a familiar chat application,
while allowing users to branch a discussion from any selected passage in a message.

A participant selects text in a message and chooses **"Reply to this"**. The application creates a separate discussion
branch linked to the source message and the exact selected passage. A branch can itself contain messages from which
further branches can be created, with no artificial nesting limit.

Each discussion is stored in one portable file. Users can exchange this file through WhatsApp or another file-sharing
method. The recipient opens the file, continues the discussion, saves it, and sends the updated file back.

The application must work without a server, account, or internet connection. Internet access is required only for
checking and downloading application updates.

## 2. Product goals

1. Provide a familiar chat-like interface.
2. Allow users to create branches from selected message text.
3. Preserve the context that led to each branch.
4. Support nested branches.
5. Store an entire discussion in one portable file.
6. Support rich-text formatting, links, and embedded images.
7. Work offline on Windows.
8. Support Russian, Cyrillic, and Unicode correctly.
9. Make file exchange straightforward for non-technical participants.
10. Check GitHub Releases for stable application updates.
11. Provide a simple Windows application deliverable, preferably a single executable.
12. Allow discussion files to be opened by double-clicking them in Windows Explorer.

## 3. Out of scope for the MVP

- Real-time synchronization.
- Server infrastructure and online user accounts.
- Concurrent editing of the same document.
- Automatic merging of independently edited copies.
- Automatic sending of messages through WhatsApp.
- Cloud storage of discussions.
- Support for operating systems other than Windows.
- Voice and video calls or audio messages.
- Cryptographic identity verification.
- Editing or deleting sent messages.

The MVP and foreseeable product scope are Windows desktop only. Do not add cross-platform or mobile requirements unless
the product scope changes.

## 4. Main user scenarios

### 4.1. Create a discussion

1. The user launches BranchChat.
2. The user creates a new discussion.
3. BranchChat uses the participant name previously saved on that computer.
4. If no participant name has been saved, the application asks the user to enter one.
5. The user writes and sends the first message.
6. The application saves the discussion to the selected document file.
7. Subsequent changes are saved automatically.

### 4.2. Continue a discussion

1. The user opens an existing discussion file.
2. The application displays the discussion in a chat-like interface.
3. Messages are shown chronologically.
4. Each message displays its author and timestamp.
5. The user writes a message in the composer at the bottom of the chat.
6. The application saves the new message.

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

1. The user selects a continuous passage of text in a message.
2. A **"Reply to this"** action becomes available.
3. The user activates the action.
4. BranchChat creates a new branch linked to the original message and selected passage.
5. The branch opens in the main chat area.
6. A side panel displays the branch hierarchy.
7. The new branch displays the relevant conversation history leading to the selected passage.
8. The selected passage is visually highlighted.
9. The user can write a reply in the new branch.
10. The branch can optionally have a user-defined title.

The branch must preserve the relationship to the original message and the selected passage.

### 4.5. Display context in a branch

When a branch is opened, the application displays the complete relevant conversation history leading up to the selected
passage.

For a branch created inside another branch, the application displays the relevant conversation path, including the
context inherited from the parent branch.

Sibling branches are not automatically included in the context.

Inherited context is read-only. It must not be duplicated as newly authored messages in the branch.

The selected passage must remain identifiable even if the original message contains formatting.

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

1. The user saves the discussion.
2. The user sends the document file through WhatsApp or another file-sharing method.
3. The recipient opens the file in BranchChat.
4. The recipient continues the discussion.
5. The recipient saves the updated file and returns it.

The application must not silently overwrite the original document when the user chooses Save As or receives an
independently edited copy.

Automatic merging of independently edited copies is not required.

### 4.9. Open a discussion file from Windows Explorer

1. The user double-clicks a BranchChat discussion file in Windows Explorer.
2. Windows launches BranchChat.
3. BranchChat opens the selected discussion file.
4. If BranchChat is already running, the application should pass the new file to the existing instance where practical.

The application should provide a clear way to register and unregister the file association.

### 4.10. Update the application

1. BranchChat checks GitHub Releases for a newer stable version.
2. The check can happen in the background.
3. The user can also select **Help > Check for updates**.
4. The application displays the available version, release date, release notes, and download size.
5. The user can choose to download the update.
6. The application verifies the downloaded package using SHA-256 when a checksum is provided.
7. The update is applied using a safe replacement process.
8. Existing discussion files and user settings are preserved.

If the computer is offline or the update check fails, BranchChat must continue to work normally.

## 5. Functional requirements

### 5.1. Discussion document

- **FR-001.** Each discussion must be stored in one self-contained file.
- **FR-002.** The file must contain messages, threads, participants, timestamps, formatting, branch relationships,
  links, and embedded images.
- **FR-003.** The application must support creating a new discussion.
- **FR-004.** The application must support opening an existing discussion.
- **FR-005.** The application must support saving a discussion.
- **FR-006.** The application must support Save As.
- **FR-007.** Sent messages must be saved automatically.
- **FR-008.** The application must warn the user if there are unsaved document changes when closing.
- **FR-009.** The application must show a useful error if a document is damaged or cannot be opened.
- **FR-010.** The document format must include a schema version.
- **FR-011.** The application must support document schema migrations where required.
- **FR-012.** The application must avoid corrupting documents created by newer unsupported versions.
- **FR-013.** Saving should use a safe atomic-write strategy where practical.
- **FR-014.** The document should use a ZIP container with a manifest, discussion data, and embedded assets.
- **FR-015.** Unknown optional fields should be preserved where practical.

Proposed internal structure:

    discussion.branchchat
      manifest.json
      discussion.json
      assets/
        images/
        attachments/

### 5.2. Participants and authorship

- **FR-016.** Every message must have an author.
- **FR-017.** The application must remember the participant name locally on each computer.
- **FR-018.** The application must not ask for the participant name every time a discussion is opened.
- **FR-019.** If no participant name is configured, the application must ask for one before the first message is sent.
- **FR-020.** Each participant must have a stable participant ID.
- **FR-021.** A participant ID must not be derived solely from the display name.
- **FR-022.** Participant ID and display name must be stored in the discussion document.
- **FR-023.** Different participants may have the same display name but must have different IDs.
- **FR-024.** Changing the local participant name must affect new messages only.
- **FR-025.** Participant identity is descriptive and is not intended to provide cryptographic authentication.

### 5.3. Chat interface

- **FR-026.** Messages must be displayed chronologically within a thread.
- **FR-027.** Each message must show its author.
- **FR-028.** Each message must show its timestamp.
- **FR-029.** The message composer must be located at the bottom of the active chat.
- **FR-030.** The interface must include a side panel for branch navigation.
- **FR-031.** The side panel must group active and closed branches.
- **FR-032.** The user must be able to navigate from a branch to its source message.
- **FR-033.** The user must be able to see the branch hierarchy.
- **FR-034.** The interface must remain usable for long discussions.
- **FR-035.** The interface should indicate when a message has branches and how many.

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

- **FR-049.** The user must be able to select any continuous text passage in a message.
- **FR-050.** A "Reply to this" action must be available when a non-empty text selection exists.
- **FR-051.** A new branch must store a reference to the source message.
- **FR-052.** A new branch must store the selected passage as a quote.
- **FR-053.** The branch must display the complete relevant source-thread history leading up to the selected passage.
- **FR-054.** The selected passage must be highlighted in the displayed context.
- **FR-055.** The branch must retain a durable reference to the source message and selected quote.
- **FR-056.** A branch may be created from a message in any existing thread.
- **FR-057.** Branch nesting must not have an arbitrary application-imposed depth limit.
- **FR-058.** A branch title must be optional and user-defined.
- **FR-059.** A branch must have an Open or Closed status.
- **FR-060.** Closing a branch must not delete its content.
- **FR-061.** The application must display the branch path and hierarchy.
- **FR-062.** Inherited context must be read-only and must not be duplicated as authored messages.
- **FR-063.** Sibling branches must not automatically appear in the context of another branch.
- **FR-064.** Child branch status must be independent of parent branch status.

### 5.6. Images and links

- **FR-065.** The user must be able to paste an image from the clipboard into a message draft.
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

### 5.7. Language and text handling

- **FR-076.** The application interface must be in Russian.
- **FR-077.** The application must correctly support Cyrillic characters.
- **FR-078.** The application must correctly support the letters ё and Ё.
- **FR-079.** The application must support emoji and mixed-language text.
- **FR-080.** Text must be stored using UTF-8.
- **FR-081.** Timestamps must be stored in UTC and displayed in the local time zone.

### 5.8. Windows application delivery and file association

- **FR-082.** The preferred deliverable is one executable file, `BranchChat.exe`.
- **FR-083.** The executable should bundle the runtime dependencies required on a supported Windows system.
- **FR-084.** Users should not need to install Java, configure environment variables, or start a local server.
- **FR-085.** If a single executable is not practical, the application should use the simplest self-contained Windows
  package and document the reason.
- **FR-086.** The proposed discussion file extension is `.branchchat`.
- **FR-087.** Windows file association must allow double-clicking a `.branchchat` file in Explorer to launch BranchChat
  and open that discussion.
- **FR-088.** If BranchChat is already running, opening another discussion file should pass the file to the existing
  instance where practical.
- **FR-089.** The application must provide a clear way to register and unregister the file association.
- **FR-090.** The application must not silently take over an existing file association.
- **FR-091.** The application must continue to support opening a discussion through File > Open.
- **FR-092.** Drag-and-drop opening should be supported where practical.

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
- **FR-101.** The application must verify SHA-256 when a checksum is published.
- **FR-102.** The application must not execute or install an update that fails verification.
- **FR-103.** The update process must preserve user settings.
- **FR-104.** The update process must not modify discussion documents.
- **FR-105.** Update failures must be reported without preventing normal offline use.
- **FR-106.** The update process must account for the fact that a running Windows executable cannot reliably replace
  itself.
- **FR-107.** A release should publish the Windows application artifact and checksum.

## 6. Non-functional requirements

- **NFR-001.** The application must work offline for all discussion operations.
- **NFR-002.** The application must support Windows 10 and Windows 11.
- **NFR-003.** The interface must work at common Windows display scaling and DPI settings.
- **NFR-004.** The application should remain responsive with discussions containing thousands of messages.
- **NFR-005.** Saving must minimize the risk of document corruption.
- **NFR-006.** The discussion file must be portable between computers.
- **NFR-007.** The application must not require a remote service for normal use.
- **NFR-008.** Update checks may contact GitHub but must never transmit document content, participant names, or message
  text.
- **NFR-009.** Unknown optional document fields and unsupported schema versions must be handled without corrupting the
  file.
- **NFR-010.** Prefer a single self-contained Windows `.exe` that runs without requiring users to install a runtime or
  manage dependencies.
- **NFR-011.** Associate the discussion extension (proposed: `.branchchat`) with BranchChat. Double-clicking a document
  in Explorer must launch BranchChat and open that document. Provide a clear, consent-based way to register and
  unregister the association.
- **NFR-012.** If a single executable is impractical, use the simplest self-contained Windows package and explain the
  trade-off.
- **NFR-013.** The application must not depend on a running remote service for local document operations.

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

### Participant

- `participantId` — stable participant identifier.
- `displayName` — participant name.

### Message

- `messageId` — unique message identifier.
- `threadId` — thread containing the message.
- `authorId` — participant who authored the message.
- `createdAt` — timestamp.
- `content` — rich-text content.
- `assetReferences` — references to embedded assets.

Sent messages are immutable.

### Thread / Branch

- `threadId` — unique thread identifier.
- `parentThreadId` — parent thread, if this is a branch.
- `sourceMessageId` — message from which the branch originated.
- `quoteText` — selected source passage.
- `selectionStart` and `selectionEnd` — optional selection offsets.
- `title` — optional branch title.
- `status` — Open or Closed.
- `createdAt` — creation timestamp.
- `createdBy` — participant who created the branch.

Selection offsets are secondary metadata. The source message ID and stored quote are the durable reference.

## 8. Architecture principles

The architecture must separate:

1. Presentation layer.
2. Domain model and branching logic.
3. Document persistence and ZIP handling.
4. Embedded asset management.
5. Windows integration.
6. Application update mechanism.

The UI technology is not yet fixed.

The domain model and document format should not depend directly on JavaFX or Spring Boot.

Avoid introducing a local HTTP server unless it provides a clear benefit.

## 9. Acceptance criteria

The MVP is acceptable when:

1. A user can create a discussion.
2. A user can save and reopen a discussion file.
3. A discussion file can be sent to another user.
4. The recipient can open and continue the discussion.
5. Every message displays its author and timestamp.
6. The local participant name is remembered.
7. The required formatting is supported.
8. Images can be pasted from the clipboard.
9. Images remain available after the document is moved to another computer.
10. Links can be opened by an explicit user action.
11. Selecting text exposes the "Reply to this" action.
12. A branch preserves its source message and selected quote.
13. A branch displays the relevant preceding conversation history.
14. Nested branches work.
15. The branch side panel distinguishes active and closed branches.
16. Closed branches can be reopened.
17. The application works without internet access.
18. The application can check for stable GitHub Releases.
19. The update process does not modify discussion documents.
20. The application can be launched through a `.branchchat` file association.
21. The application can be distributed as a single self-contained EXE or the simplest practical self-contained Windows
    package.

## 10. Confirmed product decisions

| Topic                                | Decision                                                              |
|--------------------------------------|-----------------------------------------------------------------------|
| Target platform                      | Windows 10 and Windows 11                                             |
| UI language                          | Russian                                                               |
| Discussion format                    | One portable file per discussion                                      |
| Discussion file container            | ZIP                                                                   |
| Main interface                       | Chat-like                                                             |
| Branch navigation                    | Side panel                                                            |
| Branch groups                        | Active and Closed                                                     |
| Branch closing                       | Branches can be closed and reopened                                   |
| Branch context                       | Full relevant conversation history leading up to the selected passage |
| Nested branches                      | Supported                                                             |
| Sent message editing                 | Not allowed                                                           |
| Message deletion                     | Not allowed                                                           |
| Branch deletion                      | Not allowed                                                           |
| Merge of independently edited copies | Not required for MVP                                                  |
| Images                               | Supported, including clipboard paste; embedded in document            |
| Links                                | Supported                                                             |
| Participant name                     | Remembered locally on each computer                                   |
| Participant identity                 | Stable local ID; display name is not an identity guarantee            |
| Application distribution             | Preferably a single self-contained EXE                                |
| File association                     | Double-clicking `.branchchat` opens BranchChat                        |
| Updates                              | GitHub Releases, stable releases only                                 |
| Other platforms                      | Out of scope                                                          |

## 11. Priorities

### MVP

- Windows desktop application.
- Create, open, save, and exchange discussion files.
- Chat-like message interface.
- Participant names and authorship.
- Rich-text formatting.
- Branch creation from selected text.
- Relevant inherited context.
- Nested branches.
- Branch side panel and status.
- Embedded images.
- Hyperlinks.
- Offline operation.
- Simple Windows distribution.
- `.branchchat` file association.
- GitHub stable-release update checks.

### Later, if required

- Additional export formats.
- More advanced search.
- Improved branch filtering.
- Additional document recovery tools.
- Further usability improvements.

No mobile or non-Windows client is currently planned.

## 12. Summary

BranchChat is a Windows-only, offline-first discussion application. Its defining feature is the ability to branch a
conversation from an exact selected passage while preserving the relevant preceding context.

Each discussion is a portable file that can be exchanged through ordinary file-sharing tools.

The application should be as simple to distribute and launch as possible, preferably as a single self-contained EXE.
Windows file association should allow users to open discussion files by double-clicking them in Explorer.

The UI framework and packaging technology remain architecture decisions to be validated through a working proof of
concept.