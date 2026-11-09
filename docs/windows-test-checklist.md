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

`powershell -File scripts\installer-smoke.ps1` runs sections D1, D3 and D4 automatically against `dist\BranchChat-Setup.exe`
(CI runs it too). It uninstalls BranchChat from the current user profile, so run it only on a test machine.
