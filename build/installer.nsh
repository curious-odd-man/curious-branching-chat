; BranchChat installer additions (included by electron-builder through nsis.include).
;
; electron-builder's own `fileAssociations` is NOT used: it registers the file type silently. This script instead
;  - shows a "Файлы обсуждений" page with a checkbox, ticked by default (FR-134),
;  - registers .branchchat for the current user only (HKCU, no administrator rights) if it is ticked and no other
;    program holds the type (FR-090),
;  - never shows the page and never touches the association on silent installs and updates (FR-135),
;  - removes the association on uninstall, but not when the uninstaller runs as the first step of an update (FR-135).
;
; The same registry keys are written by the application itself (src/main/windows/fileAssociation.ts).
; This file is UTF-8 with a BOM so that makensis reads the Russian text correctly.

!include nsDialogs.nsh
!include LogicLib.nsh

!define BC_EXT ".branchchat"
!define BC_PROGID "BranchChat.Discussion"
!define BC_TYPE_NAME "Обсуждение BranchChat"

!macro bcNotifyShell
  ; SHCNE_ASSOCCHANGED, so Explorer picks up the new icon and association without a restart
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customPageAfterChangeDir
  Var /GLOBAL bcAssocCheckbox
  Var /GLOBAL bcAssocChecked
  Var /GLOBAL bcAssocBlocked

  Function bcAssocPageCreate
    ; Updates and silent installs never ask (FR-135).
    ${If} ${Silent}
      Abort
    ${EndIf}
    ${If} ${isUpdated}
      Abort
    ${EndIf}

    StrCpy $bcAssocBlocked "0"
    ReadRegStr $0 HKCR "${BC_EXT}" ""
    ${If} $0 != ""
    ${AndIf} $0 != "${BC_PROGID}"
      ; Held by another program only if the value names a program that has an open command; a leftover plain
      ; text value (an earlier build) holds nothing.
      ReadRegStr $1 HKCR "$0\shell\open\command" ""
      ${If} $1 != ""
        StrCpy $bcAssocBlocked "1"
      ${EndIf}
    ${EndIf}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\${BC_EXT}\UserChoice" "ProgId"
    ${If} $0 != ""
    ${AndIf} $0 != "${BC_PROGID}"
      StrCpy $bcAssocBlocked "1"
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "Файлы обсуждений" "Как открывать файлы .branchchat"
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 36u "Файл обсуждения BranchChat — это файл с расширением .branchchat. Если включить эту возможность, двойной щелчок по такому файлу в проводнике будет открывать его в BranchChat. Это относится только к вашей учётной записи Windows, права администратора не нужны."
    Pop $0
    ${NSD_CreateCheckbox} 0 44u 100% 12u "Открывать файлы .branchchat в BranchChat"
    Pop $bcAssocCheckbox
    ${NSD_CreateLabel} 0 62u 100% 24u "Это можно отменить в любой момент: в программе (Файл > Настройки) или удалением программы."
    Pop $0

    ${If} $bcAssocBlocked == "1"
      ; Another program holds the type: never take it over (FR-090).
      EnableWindow $bcAssocCheckbox 0
      ${NSD_CreateLabel} 0 92u 100% 30u "Файлы .branchchat уже связаны с другой программой. BranchChat не будет менять эту настройку Windows."
      Pop $0
    ${Else}
      ${NSD_Check} $bcAssocCheckbox
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function bcAssocPageLeave
    ${NSD_GetState} $bcAssocCheckbox $bcAssocChecked
  FunctionEnd

  Page custom bcAssocPageCreate bcAssocPageLeave
!macroend

!macro customInstall
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    ; The question was asked here, so the application does not ask again on first start (FR-136).
    WriteRegStr HKCU "Software\BranchChat" "AssociationAsked" "1"
    ${If} $bcAssocChecked == ${BST_CHECKED}
      ; Check again at install time: nothing is taken over from another program.
      StrCpy $2 "0"
      ReadRegStr $0 HKCR "${BC_EXT}" ""
      ${If} $0 == ""
      ${OrIf} $0 == "${BC_PROGID}"
        StrCpy $2 "1"
      ${Else}
        ReadRegStr $1 HKCR "$0\shell\open\command" ""
        ${If} $1 == ""
          StrCpy $2 "1" ; a leftover plain text value, not another program
        ${EndIf}
      ${EndIf}
      ${If} $2 == "1"
        WriteRegStr HKCU "Software\Classes\${BC_PROGID}" "" "${BC_TYPE_NAME}"
        WriteRegStr HKCU "Software\Classes\${BC_PROGID}\DefaultIcon" "" "$INSTDIR\resources\document.ico,0"
        WriteRegStr HKCU "Software\Classes\${BC_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
        WriteRegStr HKCU "Software\Classes\${BC_EXT}" "" "${BC_PROGID}"
        !insertmacro bcNotifyShell
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\${BC_EXT}" ""
    ${If} $0 == "${BC_PROGID}"
      DeleteRegKey HKCU "Software\Classes\${BC_EXT}"
    ${EndIf}
    DeleteRegKey HKCU "Software\Classes\${BC_PROGID}"
    DeleteRegKey HKCU "Software\BranchChat"
    !insertmacro bcNotifyShell
  ${EndIf}
!macroend
