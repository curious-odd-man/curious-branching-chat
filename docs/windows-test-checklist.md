# Windows check for phase 7 (file association, installer page, icons)

Phase 7 was built and tested on Linux. These steps cover what only Windows can show. Use a clean Windows 10 and a
clean Windows 11 machine (or virtual machines), signed in as a **standard user** (not an administrator). Install the
`BranchChat-Setup.exe` built by CI (artifact "BranchChat-installer"). Expect the SmartScreen warning ("More info",
then "Run anyway"); the installer is unsigned by decision.

Mark each line pass or fail and note anything odd. Acceptance criteria 20 and 21 are covered by sections A to D.

## A. Install with the page ticked (default)

1. Run the installer. No administrator prompt (UAC) appears.
2. The pages are: welcome, **"Файлы обсуждений"** (the new page), install progress, finish.
3. The page shows the checkbox "Открывать файлы .branchchat в BranchChat", **ticked**. Leave it ticked and continue.
4. BranchChat is installed under `%LOCALAPPDATA%\Programs\BranchChat`.
5. In Explorer, a `.branchchat` file shows the BranchChat document icon (a page with a branch) and, in Properties,
   the type "Обсуждение BranchChat". If the old icon still shows, sign out and in once and check again.
6. Double-click a `.branchchat` file with BranchChat **not running**: it starts and shows the discussion.
7. Double-click a second `.branchchat` file with BranchChat **running**: the existing window opens it (no second
   program instance).
8. Start BranchChat: **no** question about file association appears (the installer already asked).
9. File > Settings… (Ctrl+,): the association reads "Включено…" and the box is ticked.

## B. Install with the page unticked

1. Uninstall (Settings > Apps), then run the installer again and **untick** the box.
2. Double-click a `.branchchat` file: Windows asks which app to use (BranchChat is not registered). Cancel.
3. Start BranchChat: no association question (the installer asked). Settings shows "Выключено." and the box unticked.
4. Tick the box in Settings: it turns on. Double-click now opens BranchChat.
5. Untick it: double-click asks for an app again; the registry keys `HKCU\Software\Classes\.branchchat` and
   `...\BranchChat.Discussion` are gone.

## C. Another program, and Windows' own choice

1. Register another program first (for example, "Open with" > Notepad > "Always" on a `.branchchat` file), then
   install BranchChat. On the installer page the box is **disabled and unticked**, with a note that another program
   holds the type.
2. In Settings the box is disabled and the text says another program holds the type. BranchChat never changes it.
3. Change the default back in Windows Settings > Apps > Default apps, then switch the option on in BranchChat: works.

## D. Silent install, update and uninstall

1. `BranchChat-Setup.exe /S` installs without any page and **without** registering `.branchchat`.
2. On first start of a silent install, the application asks once whether to open `.branchchat` files in BranchChat.
   "Да" registers it, "Нет" does not; neither is asked again.
3. Install version N with the box ticked, then install version N+1 over it (normal or `/S`): the association is
   still on, the page is not shown. (The same is rechecked with real GitHub updates in phase 8.)
4. Uninstall: the keys under `HKCU\Software\Classes` (`.branchchat`, `BranchChat.Discussion`) and
   `HKCU\Software\BranchChat` are removed. Discussion files and the settings folder are left alone.
5. Nothing is ever written under `HKLM`.

## E. Paths

Double-click a `.branchchat` file that is (a) in a folder with Cyrillic letters, (b) in a very long path (over 200
characters), (c) on a network share, (d) in a synced folder (OneDrive or similar). Each opens. A file that cannot be
read shows a clear error message, and the application keeps running (FR-118).

## F. Known limit

If BranchChat is moved to another folder after the association was registered, the registered command still points to
the old path. Fix: switch the option off and on in Settings.

## G. Optional automatic check

`powershell -File scripts\installer-smoke.ps1` runs sections D1, D3 and D4 automatically against
`dist\BranchChat-Setup.exe`
(CI runs it too). It uninstalls BranchChat from the current user profile, so run it only on a test machine.

## H. Updates (phase 8) — needs a private or public test repository with real releases

Set `owner` and `repo` in `electron-builder.yml`, build versions 0.1.0 and 0.2.0 with CI (so each release has
`BranchChat-Setup.exe`, `latest.yml` and the blockmap), publish both as normal (non-draft, non-prerelease) GitHub
Releases of a **public** repository.

1. Install 0.1.0 (association page ticked). About 20 seconds after start a banner "Доступно обновление BranchChat
   0.2.0" appears; no dialog interrupts. "Подробнее" shows version, release date, notes (plain text) and size.
2. "Страница релиза" opens the release in the browser.
3. "Скачать": progress is shown, then "Обновление загружено". Close BranchChat normally: it updates silently, with no
   installer pages. Start it again: version 0.2.0; settings, name and `.branchchat` association are unchanged; open
   discussions are unchanged (compare file hashes of a few discussions before and after: they must be identical).
4. Repeat from 0.1.0 with "Перезапустить и установить": the application closes, updates and starts again by itself.
5. Corrupted release: edit `latest.yml` of a test release so its `sha512` is wrong. The download ends with "не прошёл
   проверку целостности"; nothing is installed; 0.1.0 keeps working.
6. Interrupted download: disconnect the network during the download. An error with "Повторить" appears; after
   reconnecting, "Повторить" completes the download.
7. Offline start: start with the network off. No error or dialog appears; File > Open and everything else work. Help >
   Проверить обновления… explains that the check failed.
8. Settings: turn "Проверять обновления автоматически" off, restart: no banner and no network request to GitHub (check
   with a proxy such as Fiddler or Wireshark). The Help menu check still works.
9. Network traffic (NFR-008): with a proxy, make a check and a download; the requests go to github.com only and contain
   no discussion titles, names or message text (only the standard headers and a User-Agent).
10. Pre-release and draft: publish 0.3.0 as a pre-release and another as a draft: neither is offered.
11. Unsigned installer: SmartScreen may warn during a manual download; during an update the silent install is not
    interrupted by SmartScreen (record what you see).

## I. Hardening and release (phase 9) — on a real Windows machine

1. **WhatsApp exchange (criteria 3, 4, 9).** Person A creates a discussion with formatting, a picture and two branches,
   sends the `.branchchat` file through WhatsApp as a document. Person B (another PC) downloads it, opens it, replies
   in a branch, and sends it back. Person A opens the returned file: B's messages and read marks are there, the picture
   shows, nothing is lost. Repeat with a file name that contains Russian letters and spaces. Record whether WhatsApp
   changed the file name or extension (it must stay `.branchchat`; if WhatsApp renames it, note how).
2. **Display scaling (NFR-003).** Windows Settings > Display > Scale: 100 %, 125 %, 150 %, 200 %. At each, open a
   discussion with a branch, shrink the window to its smallest size: the message list, composer and Send button stay
   visible; text is sharp; nothing is cut off. Move the window between two monitors with different scaling if
   available.
3. **High contrast.** Settings > Accessibility > Contrast themes (Aquatic, Desert, Dusk, Night sky). Unread messages,
   the selected branch, the quote mark and focus remain recognizable without color; text stays readable.
4. **Keyboard.** Using only the keyboard: open a file, move between branches (Tab), write and send (Ctrl+Enter),
   open Settings (Файл > Настройки…), close it with Esc and see focus return to the message field.
5. **Russian text.** Type text with ё/Ё and an emoji; save, close, reopen: unchanged. Spell check underlines a
   deliberate mistake in Russian and offers corrections on right-click (needs the Russian language pack in Windows).
6. **Performance on the oldest machine.** Open a discussion with 5,000+ messages and one with 300 pictures; note start
   time and whether typing and scrolling stay smooth. Add the numbers to `performance.md`.
7. **Release.** Follow `release-process.md` for a real `1.0.0` tag. The release page has the installer, `latest.yml`,
   blockmap, SHA-256 file and the checksum in the text. Download the installer in a browser: SmartScreen warns; the
   steps in `user-guide.ru.md` match what you see (take screenshots for the guide). `Get-FileHash` equals the
   published value. Install, then update from 1.0.0 to 1.0.1 (section H).
8. **Clean-machine install.** On a fresh Windows 10 and a fresh Windows 11 (no Node, no other runtimes), install from
   the single exe and complete A, D and H.

## J. Recent discussions and startup

1. Open three discussions in turn, close BranchChat, start it from the Start menu: the most recent discussion opens by
   itself (one window). Settings > turn "Открывать последнее обсуждение при запуске" off, restart: the start screen
   shows
   the list, newest first.
2. Move one listed file to another folder: it is greyed out with "файл не найден"; clicking it shows the message; ✕
   removes it. If the most recent file is the missing one, startup shows the start screen.
3. File > Открыть недавние shows the files (the missing one disabled) and opens the chosen one.
4. Right-click the BranchChat taskbar icon: category "Недавние" lists the files; choosing one opens it (also when
   BranchChat is not running, also when the `.branchchat` association is switched off). A missing file is not listed.
5. Double-click a `.branchchat` file in Explorer while "open last file" is on: only that file opens, not the last one
   too.
6. Settings > recent files number: set 2, the list shrinks to 2 and the menu and jump list follow; set 0, the list is
   gone; type -1 or 1.5, the old value comes back.
7. Update from the previous version: the option is on without any action (FR-148), the list is empty until files are
   opened.

## K. File association with leftovers (regression)

1. In PowerShell set a leftover value: `reg add "HKCU\Software\Classes\.branchchat" /ve /d "Обсуждение BranchChat" /f`
   (and make sure `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.branchchat\UserChoice` does not
   exist).
2. Run the installer: the "Файлы обсуждений" page offers the checkbox **enabled and ticked**. Finish: double-click opens
   BranchChat;
   `reg query "HKCU\Software\Classes\.branchchat" /ve` now shows `BranchChat.Discussion`.
3. Repeat with Settings instead of the installer (silent install, then Файл > Настройки…): the checkbox is enabled.
4. A real other program: `reg add "HKCU\Software\Classes\.branchchat" /ve /d "txtfile" /f` (txtfile has an open
   command): both the
   installer and Settings show the type as held by another program and disable the checkbox.

## L. Release 1.1: file format version 2 and encryption key

1. Open a discussion made by version 1.0. It shows the same messages in the same order. Send a message, close, open
   again: the order is the same. The file is now version 2 (version 1.0 can no longer open it; that is expected).
2. Файл > Настройки… > «Ключ шифрования»: a fingerprint of 8 groups of 4 characters shows. The file
   `%APPDATA%\BranchChat\keys\identity.json` exists; it contains no private key in clear text (`protectedSecret` is
   DPAPI data).
3. Close and start BranchChat again: the same fingerprint.
4. «Скопировать мой ключ», paste into Notepad: one line that starts with `BRANCHCHAT-KEY-1:`.
5. «Сохранить мой ключ…»: the save dialog suggests `<имя>.bckey` in Documents; the file is JSON with the same
   fingerprint.
6. Install the update over 1.1 (silent update): the fingerprint stays the same.
7. Log in as another Windows user (or copy `identity.json` to another user's profile): BranchChat cannot read the key
   (DPAPI belongs to the account), creates a new one, and Settings says that the earlier key could not be read.
