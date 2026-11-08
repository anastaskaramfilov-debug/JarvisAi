; Inno Setup script for Jarvis Setup.exe (built by GitHub Actions)
#ifndef MyVersion
  #define MyVersion "0.0.0"
#endif

[Setup]
AppId={{8F2A6C1E-4B7D-4E21-9C55-1A7E3D9B6F42}
AppName=Jarvis
AppVersion={#MyVersion}
AppVerName=Jarvis {#MyVersion}
AppPublisher=Jarvis
DefaultDirName={localappdata}\Programs\Jarvis
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=Jarvis-Setup-{#MyVersion}
SetupIconFile=..\jarvis.ico
UninstallDisplayIcon={app}\Jarvis.exe
UninstallDisplayName=Jarvis
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Put Jarvis on the desktop"
Name: "startup"; Description: "Start Jarvis quietly in the tray when Windows starts (reminders and announcements keep working)"; Flags: unchecked

[InstallDelete]
; a new version replaces the old program files completely (your data in %APPDATA%\Jarvis is untouched)
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\dist\Jarvis\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Jarvis"; Filename: "{app}\Jarvis.exe"; HotKey: ctrl+alt+j; Comment: "Your personal assistant"
Name: "{autodesktop}\Jarvis"; Filename: "{app}\Jarvis.exe"; Tasks: desktopicon
Name: "{userstartup}\Jarvis"; Filename: "{app}\Jarvis.exe"; Parameters: "--background"; Tasks: startup

[Run]
Filename: "{app}\Jarvis.exe"; Description: "Open Jarvis"; Flags: nowait postinstall

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM Jarvis.exe /F"; Flags: runhidden; RunOnceId: "StopJarvis"
