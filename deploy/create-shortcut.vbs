Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${desktopDir}\\cDesigner.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "javaw"
oLink.Arguments = "-D" & Chr(34) & "spring.profiles.active=prod" & Chr(34) & " -jar " & Chr(34) & "${deployDir}\\\\${jarName}" & Chr(34)
oLink.WorkingDirectory = "${deployDir}"
oLink.IconLocation = "${deployDir}\\cDesigner.ico, 0"
oLink.Description = "Launch cDesigner"
oLink.Save