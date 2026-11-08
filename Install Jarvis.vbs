' J.A.R.V.I.S. one-time setup: desktop icon, Start menu entry, Ctrl+Alt+J shortcut, optional start with Windows.
Option Explicit
Dim sh, fso, dir, startup, ans
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
startup = sh.SpecialFolders("Startup")

MakeLink sh.SpecialFolders("Desktop") & "\Jarvis.lnk", "", "CTRL+ALT+J"
MakeLink sh.SpecialFolders("Programs") & "\Jarvis.lnk", "", ""

ans = MsgBox("Start Jarvis quietly in the background whenever Windows starts?" & vbCrLf & vbCrLf & _
  "Yes = Jarvis opens instantly and your reminders work all day." & vbCrLf & _
  "No = Jarvis only runs when you open it.", vbYesNo + vbQuestion, "J.A.R.V.I.S. setup")
If ans = vbYes Then
  MakeLink startup & "\Jarvis (background).lnk", "/background", ""
ElseIf fso.FileExists(startup & "\Jarvis (background).lnk") Then
  fso.DeleteFile startup & "\Jarvis (background).lnk"
End If

MsgBox "All set, sir." & vbCrLf & vbCrLf & "Open Jarvis with the Jarvis icon on your desktop, from the Start menu, " & _
  "or press Ctrl + Alt + J anywhere.", 64, "J.A.R.V.I.S. setup"
sh.Run "wscript.exe """ & dir & "\Jarvis.vbs""", 1, False

Sub MakeLink(path, args, hotkey)
  Dim l
  Set l = sh.CreateShortcut(path)
  l.TargetPath = sh.ExpandEnvironmentStrings("%WINDIR%\System32\wscript.exe")
  l.Arguments = """" & dir & "\Jarvis.vbs"" " & args
  l.WorkingDirectory = dir
  l.IconLocation = dir & "\jarvis.ico,0"
  l.Description = "J.A.R.V.I.S. personal assistant"
  If hotkey <> "" Then l.Hotkey = hotkey
  l.Save
End Sub
