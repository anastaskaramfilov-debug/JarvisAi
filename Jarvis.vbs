' J.A.R.V.I.S. launcher
' Starts the Jarvis server quietly (no black window) and opens Jarvis in its own app window.
' Run with /background to only start the server (used when Windows starts).
' Run with /restart (from the Restart now button): wait for the old Jarvis to stop, then start the new one.
Option Explicit
Dim sh, fso, dir, url, bg, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:5005"
bg = False
If WScript.Arguments.Count > 0 Then bg = (LCase(WScript.Arguments(0)) = "/background")
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/restart" Then
    bg = True
    For i = 1 To 40                      ' up to 20 seconds for the old Jarvis to close
      If Not ServerUp() Then Exit For
      WScript.Sleep 500
    Next
    WScript.Sleep 700
  End If
End If

If Not ServerUp() Then
  If Not fso.FileExists(dir & "\venv\Scripts\pythonw.exe") Then
    MsgBox "Jarvis isn't installed yet. Double-click 'Start Jarvis.bat' once, then try again.", 48, "J.A.R.V.I.S."
    WScript.Quit
  End If
  sh.CurrentDirectory = dir
  ' Install new packages if Jarvis was updated (requirements.txt is newer than the last install)
  If fso.FileExists(dir & "\requirements.txt") Then
    Dim need : need = True
    If fso.FileExists(dir & "\.installed") Then
      need = (fso.GetFile(dir & "\requirements.txt").DateLastModified > fso.GetFile(dir & "\.installed").DateLastModified)
    End If
    If need Then
      sh.Run """" & dir & "\venv\Scripts\python.exe"" -m pip install -q -r """ & dir & "\requirements.txt""", 0, True
      fso.CreateTextFile(dir & "\.installed", True).Write Now
    End If
  End If
  sh.Environment("PROCESS")("JARVIS_NO_BROWSER") = "1"
  sh.Run """" & dir & "\venv\Scripts\pythonw.exe"" """ & dir & "\jarvis_server.py""", 0, False
  For i = 1 To 80
    WScript.Sleep 500
    If ServerUp() Then Exit For
  Next
End If

EnsureHotkey
If Not bg Then OpenWindow

' Installing Jarvis as an app can replace the desktop icon that held Ctrl+Alt+J. If so, put the
' shortcut key on the Start menu entry instead, so Ctrl+Alt+J keeps starting Jarvis.
Sub EnsureHotkey()
  On Error Resume Next
  Dim d, p, ld, lp
  d = sh.SpecialFolders("Desktop") & "\Jarvis.lnk"
  p = sh.SpecialFolders("Programs") & "\Jarvis.lnk"
  If fso.FileExists(d) Then
    Set ld = sh.CreateShortcut(d)
    If InStr(1, ld.Arguments, "Jarvis.vbs", 1) > 0 Then Exit Sub
  End If
  If fso.FileExists(p) Then
    Set lp = sh.CreateShortcut(p)
    If InStr(1, lp.Arguments, "Jarvis.vbs", 1) > 0 And InStr(1, lp.Hotkey, "J", 1) = 0 Then
      lp.Hotkey = "CTRL+ALT+J"
      lp.Save
    End If
  End If
  Err.Clear
End Sub

Function ServerUp()
  Dim x
  ServerUp = False
  On Error Resume Next
  Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 800, 800, 800, 800
  x.Open "GET", url & "/api/ping", False
  x.Send
  If Err.Number = 0 Then ServerUp = (x.Status = 200)
  Err.Clear
  On Error GoTo 0
End Function

Sub OpenWindow()
  On Error Resume Next
  ' If Jarvis was installed as an app (Settings > General > App window), open that: no grey title bar.
  Dim apps, lnk, k
  apps = Array(sh.ExpandEnvironmentStrings("%APPDATA%") & "\Microsoft\Windows\Start Menu\Programs\Chrome Apps\Jarvis.lnk", _
               sh.ExpandEnvironmentStrings("%APPDATA%") & "\Microsoft\Windows\Start Menu\Programs\Jarvis.lnk", _
               sh.SpecialFolders("Desktop") & "\Jarvis.lnk")
  For k = 0 To UBound(apps)
    lnk = apps(k)
    If fso.FileExists(lnk) Then
      If InStr(1, sh.CreateShortcut(lnk).Arguments, "--app-id", 1) > 0 Then
        sh.Run """" & lnk & """", 1, False
        If Err.Number = 0 Then Exit Sub
        Err.Clear
      End If
    End If
  Next
  sh.Run "chrome --app=" & url & " --window-size=1500,920", 1, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run "msedge --app=" & url & " --window-size=1500,920", 1, False
    If Err.Number <> 0 Then
      Err.Clear
      sh.Run url, 1, False
    End If
  End If
  On Error GoTo 0
End Sub
