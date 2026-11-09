# Smoke test of the real installer on Windows (run by CI; can also be run by hand on a test machine).
# Checks the parts that cannot be tested on Linux: silent install, the file association rules, update and uninstall.
# Usage: powershell -File scripts/installer-smoke.ps1 [-Installer dist\BranchChat-Setup.exe]
param([string]$Installer = "dist\BranchChat-Setup.exe")
$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "Programs\BranchChat"
$ext = "HKCU:\Software\Classes\.branchchat"
$progId = "HKCU:\Software\Classes\BranchChat.Discussion"

function Assert($condition, $message) {
  if (-not $condition) { throw "FAILED: $message" }
  Write-Host "ok: $message"
}
function Run-Installer($arguments) {
  $p = Start-Process -FilePath $Installer -ArgumentList $arguments -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Installer exited with $($p.ExitCode) for: $arguments" }
}
function Run-Uninstaller($arguments) {
  $u = Join-Path $installDir "Uninstall BranchChat.exe"
  $p = Start-Process -FilePath $u -ArgumentList $arguments -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "Uninstaller exited with $($p.ExitCode) for: $arguments" }
}
function Association-Default() { (Get-ItemProperty -Path $ext -ErrorAction SilentlyContinue).'(default)' }

Assert (Test-Path $Installer) "installer exists"

# 1. A silent install (no administrator rights) never registers the association (FR-135).
Run-Installer "/S"
Assert (Test-Path (Join-Path $installDir "BranchChat.exe")) "silent install put the program in the per-user folder"
Assert (Test-Path (Join-Path $installDir "resources\document.ico")) "document icon is installed"
Assert (-not (Test-Path $ext)) "silent install did not register .branchchat"
Assert (-not (Test-Path "HKLM:\Software\Classes\.branchchat")) "nothing was written under HKLM"

# 2. Simulate what the installer page does and what the application does: the association written by an earlier
#    install survives an update (silent reinstall over the top), and is left alone.
New-Item -Path $ext -Force | Out-Null
Set-ItemProperty -Path $ext -Name "(default)" -Value "BranchChat.Discussion"
New-Item -Path "$progId\shell\open\command" -Force | Out-Null
Run-Installer "/S --updated"
Assert ((Association-Default) -eq "BranchChat.Discussion") "an update keeps the association"

# 3. Uninstalling removes it (FR-089).
Run-Uninstaller "/S"
Assert (-not (Test-Path $ext)) "uninstall removed the .branchchat key"
Assert (-not (Test-Path $progId)) "uninstall removed the BranchChat.Discussion key"
Assert (-not (Test-Path (Join-Path $installDir "BranchChat.exe"))) "uninstall removed the program"

# 4. A type held by another program is not touched by uninstall (we only remove what is ours).
Run-Installer "/S"
New-Item -Path $ext -Force | Out-Null
Set-ItemProperty -Path $ext -Name "(default)" -Value "Other.App"
Run-Uninstaller "/S"
Assert ((Association-Default) -eq "Other.App") "uninstall left another program's association alone"
Remove-Item -Path $ext -Recurse -Force

Write-Host "Installer smoke test passed."
