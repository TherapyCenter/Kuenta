; Kuenta – Windows installer (Inno Setup 6)
; Do not compile directly, use build.ps1 (it prepares build\stage and sets the version).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\..\build\stage"
#endif
#ifndef OutDir
  #define OutDir "..\..\build"
#endif

#define AppName "Kuenta"

[Setup]
AppId={{6E0B7C2A-3F1D-4B9E-9C55-2A7F4D8E1B63}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Kuenta
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Default: for all users (admin). "Only for me" can be chosen in the dialog (no admin rights).
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename=Kuenta-Setup-{#AppVersion}
SetupIconFile=kuenta.ico
UninstallDisplayIcon={app}\kuenta.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; stop-kuenta.ps1 stops a running Kuenta itself (see [Code]); the Windows Restart Manager
; does not detect the console window reliably and is therefore not used.
CloseApplications=no
RestartApplications=no
; language: detected from the Windows display language, the dialog only appears if none matches;
; updates keep the language of the first installation
ShowLanguageDialog=auto
UsePreviousLanguage=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[CustomMessages]
en.TaskDesktop=Create a &desktop shortcut
de.TaskDesktop=Verknüpfung auf dem &Desktop anlegen
es.TaskDesktop=Crear un acceso directo en el &escritorio
en.GroupShortcuts=Additional shortcuts:
de.GroupShortcuts=Zusätzliche Verknüpfungen:
es.GroupShortcuts=Accesos directos adicionales:
en.TaskFirewall=Network mode: allow Kuenta in the Windows firewall (for tablets / other workstations)
de.TaskFirewall=Netzwerkbetrieb: Windows-Firewall für Kuenta freigeben (für Tablets / weitere Arbeitsplätze)
es.TaskFirewall=Modo red: permitir Kuenta en el cortafuegos de Windows (para tabletas / otros puestos)
en.GroupNetwork=Network:
de.GroupNetwork=Netzwerk:
es.GroupNetwork=Red:
en.IconNetwork=Kuenta (network)
de.IconNetwork=Kuenta im Netzwerk
es.IconNetwork=Kuenta (red)
en.IconUninstall=Uninstall Kuenta
de.IconUninstall=Kuenta deinstallieren
es.IconUninstall=Desinstalar Kuenta
en.CommentStart=Start Kuenta
de.CommentStart=Kuenta starten
es.CommentStart=Iniciar Kuenta
en.CommentNetwork=Share Kuenta with other devices in the network
de.CommentNetwork=Kuenta für andere Geräte im Netzwerk freigeben
es.CommentNetwork=Compartir Kuenta con otros dispositivos de la red
en.RunNow=Start Kuenta now
de.RunNow=Kuenta jetzt starten
es.RunNow=Iniciar Kuenta ahora

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:GroupShortcuts}"
Name: "firewall"; Description: "{cm:TaskFirewall}"; GroupDescription: "{cm:GroupNetwork}"; Flags: unchecked; Check: IsAdminInstallMode

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "kuenta.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-kuenta.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-kuenta.ps1"; Flags: dontcopy

[InstallDelete]
; remove program files of earlier versions (user data lives in the user profile under AppData\Roaming\Kuenta and is kept)
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\public"
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\sms-relais"

[Icons]
Name: "{group}\Kuenta"; Filename: "{app}\Kuenta starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuenta.ico"; Comment: "{cm:CommentStart}"
Name: "{group}\{cm:IconNetwork}"; Filename: "{app}\Kuenta im Netzwerk starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuenta.ico"; Comment: "{cm:CommentNetwork}"
Name: "{group}\{cm:IconUninstall}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Kuenta"; Filename: "{app}\Kuenta starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuenta.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Kuenta"""; Flags: runhidden; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Kuenta"" dir=in action=allow program=""{app}\node\node.exe"" enable=yes profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "{app}\Kuenta starten.bat"; WorkingDir: "{app}"; Description: "{cm:RunNow}"; Flags: postinstall nowait skipifsilent shellexec runasoriginaluser; Check: NichtNeuStarten
; Kuenta was running before the update: start it again the way it ran (also for silent installs)
Filename: "{app}\Kuenta starten.bat"; WorkingDir: "{app}"; Flags: nowait shellexec runasoriginaluser; Check: NeuStarten(1)
Filename: "{app}\Kuenta im Netzwerk starten.bat"; WorkingDir: "{app}"; Flags: nowait shellexec runasoriginaluser; Check: NeuStarten(2)

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Kuenta"""; Flags: runhidden; RunOnceId: "DelFirewall"; Check: IsAdminInstallMode

[Messages]
en.FinishedLabel=Kuenta has been installed.%n%nYour data is stored in the user profile (AppData\Roaming\Kuenta) and is kept during updates and when uninstalling. To take over existing data after the start, use "Kuenta → Import data from KFZ-Faktura" or "Restore data". The language can be changed in Kuenta under "Kuenta → Sprache / Language".
es.FinishedLabel=Kuenta se ha instalado.%n%nSus datos se guardan en el perfil de usuario (AppData\Roaming\Kuenta) y se conservan en las actualizaciones y al desinstalar. Para importar datos existentes tras el inicio, use «Kuenta → Importar datos de KFZ-Faktura» o «Restaurar datos». El idioma se cambia en Kuenta en «Kuenta → Sprache / Language».
de.FinishedLabel=Kuenta wurde installiert.%n%nIhre Daten werden im Benutzerprofil gespeichert (AppData\Roaming\Kuenta) und bleiben bei Updates und bei der Deinstallation erhalten. Vorhandene Daten übernehmen Sie nach dem Start über „Kuenta → Daten aus KFZ-Faktura importieren“ oder „Daten wiederherstellen“.

[Code]
var
  KuentaLief: Integer; { 0 = not running, 1 = running locally, 2 = running in network mode }

function StopKuenta(Script, AppDir: String): Integer;
var
  Rc: Integer;
begin
  Result := 0;
  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
          '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + AppDir + '"',
          '', SW_HIDE, ewWaitUntilTerminated, Rc) then
    if (Rc = 1) or (Rc = 2) then Result := Rc;
end;

{ Before copying: stop a running Kuenta from the program folder }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  KuentaLief := 0;
  if DirExists(ExpandConstant('{app}')) then
  begin
    ExtractTemporaryFile('stop-kuenta.ps1');
    KuentaLief := StopKuenta(ExpandConstant('{tmp}\stop-kuenta.ps1'), ExpandConstant('{app}'));
    if KuentaLief > 0 then Log('Running Kuenta was stopped (mode ' + IntToStr(KuentaLief) + ').');
  end;
end;

{ Do not restart with /NOSTART or when deployed as the system account (Kuenta would otherwise run in the wrong user profile) }
function NeustartErlaubt: Boolean;
var
  U: String;
begin
  U := Uppercase(GetUserNameString);
  Result := (Pos('/NOSTART', Uppercase(GetCmdTail)) = 0) and (U <> 'SYSTEM') and (Copy(U, Length(U), 1) <> '$');
end;

function NeuStarten(Modus: Integer): Boolean;
begin
  Result := (KuentaLief = Modus) and NeustartErlaubt;
end;

function NichtNeuStarten: Boolean;
begin
  Result := not ((KuentaLief > 0) and NeustartErlaubt);
end;

{ Stop it before uninstalling as well }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and FileExists(ExpandConstant('{app}\stop-kuenta.ps1')) then
    StopKuenta(ExpandConstant('{app}\stop-kuenta.ps1'), ExpandConstant('{app}'));
end;
