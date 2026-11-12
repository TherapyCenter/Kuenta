; KuentaPOS – Windows installer (Inno Setup 6)
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

; name, id and data folder can be overridden for a separate test build (build.ps1 never does)
#ifndef AppName
  #define AppName "KuentaPOS"
#endif
#ifndef AppGuid
  #define AppGuid "6E0B7C2A-3F1D-4B9E-9C55-2A7F4D8E1B63"
#endif
#ifndef DataName
  #define DataName "KuentaPOS"
#endif

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=KuentaPOS
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; up to version 1.8.2 the start menu folder was called Kuenta: use the new name (the old folder is removed below)
UsePreviousGroup=no
; Default: for all users (admin). "Only for me" can be chosen in the dialog (no admin rights).
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
SetupIconFile=kuentapos.ico
UninstallDisplayIcon={app}\kuentapos.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; stop-kuentapos.ps1 stops a running KuentaPOS itself (see [Code]); the Windows Restart Manager
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
en.TaskFirewall=Network mode: allow KuentaPOS in the Windows firewall (for tablets / other workstations)
de.TaskFirewall=Netzwerkbetrieb: Windows-Firewall für KuentaPOS freigeben (für Tablets / weitere Arbeitsplätze)
es.TaskFirewall=Modo red: permitir KuentaPOS en el cortafuegos de Windows (para tabletas / otros puestos)
en.GroupNetwork=Network:
de.GroupNetwork=Netzwerk:
es.GroupNetwork=Red:
en.IconNetwork=KuentaPOS (network)
de.IconNetwork=KuentaPOS im Netzwerk
es.IconNetwork=KuentaPOS (red)
en.IconUninstall=Uninstall KuentaPOS
de.IconUninstall=KuentaPOS deinstallieren
es.IconUninstall=Desinstalar KuentaPOS
en.CommentStart=Start KuentaPOS
de.CommentStart=KuentaPOS starten
es.CommentStart=Iniciar KuentaPOS
en.CommentNetwork=Share KuentaPOS with other devices in the network
de.CommentNetwork=KuentaPOS für andere Geräte im Netzwerk freigeben
es.CommentNetwork=Compartir KuentaPOS con otros dispositivos de la red
en.RunNow=Start KuentaPOS now
en.MaintTitle=KuentaPOS is already installed
en.MaintSub=Version %1 is installed on this computer.
en.MaintWhat=What would you like to do?
en.MaintUpdate=Install KuentaPOS {#AppVersion} (replaces version %1, your data is kept)
en.MaintRemove=Uninstall KuentaPOS (you can choose whether to keep your data)
en.MaintNoUninst=The uninstaller of the installed version was not found. Please remove KuentaPOS under Settings → Apps.
en.DelDataAsk=Also delete your KuentaPOS data?%n%nFolder: %1%n%nIt contains customers, vehicles, invoices, cash register data and backups. Tax law usually requires you to keep invoices and cash register data for up to 10 years.%n%nNo = keep the data (recommended, e.g. for a later reinstallation).
en.DelDataBackup=Save a copy of all data as a ZIP file on the desktop before deleting?%n%nYes = save a copy, then delete (recommended)%nNo = delete without a copy
en.DelDataNoBackup=The data will be deleted for good, without a copy. Continue?
en.DelDataBackupFailed=The copy could not be saved. Your data was NOT deleted.%n%nFolder: %1
en.DelDataDone=Your KuentaPOS data has been deleted.
en.DelDataCopy=Copy of the data: %1
en.DelDataFailed=Some files could not be deleted. Please remove the folder by hand: %1
de.RunNow=KuentaPOS jetzt starten
de.MaintTitle=KuentaPOS ist bereits installiert
de.MaintSub=Auf diesem Computer ist Version %1 installiert.
de.MaintWhat=Was möchten Sie tun?
de.MaintUpdate=KuentaPOS {#AppVersion} installieren (ersetzt Version %1, Ihre Daten bleiben erhalten)
de.MaintRemove=KuentaPOS deinstallieren (Sie entscheiden, ob Ihre Daten erhalten bleiben)
de.MaintNoUninst=Das Deinstallationsprogramm der installierten Version wurde nicht gefunden. Bitte KuentaPOS unter Einstellungen → Apps entfernen.
de.DelDataAsk=Sollen auch Ihre KuentaPOS-Daten gelöscht werden?%n%nOrdner: %1%n%nDarin liegen Kunden, Fahrzeuge, Rechnungen, Kassendaten und Sicherungen. Rechnungen und Kassendaten müssen Sie nach Steuerrecht in der Regel bis zu 10 Jahre aufbewahren.%n%nNein = Daten behalten (empfohlen, z. B. für eine spätere Neuinstallation).
de.DelDataBackup=Vor dem Löschen eine Kopie aller Daten als ZIP-Datei auf dem Desktop speichern?%n%nJa = Kopie speichern und dann löschen (empfohlen)%nNein = ohne Kopie löschen
de.DelDataNoBackup=Die Daten werden ohne Kopie endgültig gelöscht. Wirklich fortfahren?
de.DelDataBackupFailed=Die Kopie konnte nicht gespeichert werden. Ihre Daten wurden NICHT gelöscht.%n%nOrdner: %1
de.DelDataDone=Ihre KuentaPOS-Daten wurden gelöscht.
de.DelDataCopy=Kopie der Daten: %1
de.DelDataFailed=Einige Dateien konnten nicht gelöscht werden. Bitte den Ordner von Hand entfernen: %1
es.RunNow=Iniciar KuentaPOS ahora
es.MaintTitle=KuentaPOS ya está instalado
es.MaintSub=En este ordenador está instalada la versión %1.
es.MaintWhat=¿Qué desea hacer?
es.MaintUpdate=Instalar KuentaPOS {#AppVersion} (sustituye la versión %1, sus datos se conservan)
es.MaintRemove=Desinstalar KuentaPOS (puede elegir si conserva sus datos)
es.MaintNoUninst=No se encontró el desinstalador de la versión instalada. Elimine KuentaPOS en Configuración → Aplicaciones.
es.DelDataAsk=¿Borrar también sus datos de KuentaPOS?%n%nCarpeta: %1%n%nContiene clientes, vehículos, facturas, datos de caja y copias de seguridad. La legislación fiscal suele exigir conservar facturas y datos de caja hasta 10 años.%n%nNo = conservar los datos (recomendado, p. ej. para reinstalar más tarde).
es.DelDataBackup=¿Guardar antes una copia de todos los datos como archivo ZIP en el escritorio?%n%nSí = guardar una copia y luego borrar (recomendado)%nNo = borrar sin copia
es.DelDataNoBackup=Los datos se borrarán definitivamente, sin copia. ¿Continuar?
es.DelDataBackupFailed=No se pudo guardar la copia. Sus datos NO se han borrado.%n%nCarpeta: %1
es.DelDataDone=Sus datos de KuentaPOS se han borrado.
es.DelDataCopy=Copia de los datos: %1
es.DelDataFailed=Algunos archivos no se pudieron borrar. Elimine la carpeta a mano: %1

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"; GroupDescription: "{cm:GroupShortcuts}"
Name: "firewall"; Description: "{cm:TaskFirewall}"; GroupDescription: "{cm:GroupNetwork}"; Flags: unchecked; Check: IsAdminInstallMode

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "kuentapos.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-kuentapos.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-kuentapos.ps1"; Flags: dontcopy

[InstallDelete]
; remove program files of earlier versions (user data lives in the user profile under AppData\Roaming\KuentaPOS and is kept)
Type: filesandordirs; Name: "{app}\server"
Type: filesandordirs; Name: "{app}\public"
Type: filesandordirs; Name: "{app}\docs"
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\sms-relais"
; files and shortcuts under the old name Kuenta (up to version 1.8.2)
Type: files; Name: "{app}\Kuenta starten.bat"
Type: files; Name: "{app}\Kuenta im Netzwerk starten.bat"
Type: files; Name: "{app}\kuenta.ico"
Type: files; Name: "{app}\stop-kuenta.ps1"
Type: files; Name: "{autodesktop}\Kuenta.lnk"
Type: filesandordirs; Name: "{autoprograms}\Kuenta"

[Icons]
Name: "{group}\KuentaPOS"; Filename: "{app}\KuentaPOS starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuentapos.ico"; Comment: "{cm:CommentStart}"
Name: "{group}\{cm:IconNetwork}"; Filename: "{app}\KuentaPOS im Netzwerk starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuentapos.ico"; Comment: "{cm:CommentNetwork}"
Name: "{group}\{cm:IconUninstall}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\KuentaPOS starten.bat"; WorkingDir: "{app}"; IconFilename: "{app}\kuentapos.ico"; Tasks: desktopicon

[Run]
; firewall rule under the old name Kuenta (up to version 1.8.2)
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Kuenta"""; Flags: runhidden; Check: IsAdminInstallMode
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""KuentaPOS"""; Flags: runhidden; Tasks: firewall
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""KuentaPOS"" dir=in action=allow program=""{app}\node\node.exe"" enable=yes profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "{app}\KuentaPOS starten.bat"; WorkingDir: "{app}"; Description: "{cm:RunNow}"; Flags: postinstall nowait skipifsilent shellexec runasoriginaluser; Check: NichtNeuStarten
; KuentaPOS was running before the update: start it again the way it ran (also for silent installs)
Filename: "{app}\KuentaPOS starten.bat"; WorkingDir: "{app}"; Flags: nowait shellexec runasoriginaluser; Check: NeuStarten(1)
Filename: "{app}\KuentaPOS im Netzwerk starten.bat"; WorkingDir: "{app}"; Flags: nowait shellexec runasoriginaluser; Check: NeuStarten(2)

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""KuentaPOS"""; Flags: runhidden; RunOnceId: "DelFirewall"; Check: IsAdminInstallMode

[Messages]
en.FinishedLabel=KuentaPOS has been installed.%n%nYour data is stored in the user profile (AppData\Roaming\KuentaPOS) and is kept during updates. When uninstalling you can choose whether to keep it. To take over existing data after the start, use "KuentaPOS → Import data from KFZ-Faktura" or "Restore data". The language can be changed in KuentaPOS under "KuentaPOS → Sprache / Language".
es.FinishedLabel=KuentaPOS se ha instalado.%n%nSus datos se guardan en el perfil de usuario (AppData\Roaming\KuentaPOS) y se conservan en las actualizaciones. Al desinstalar puede elegir si los conserva. Para importar datos existentes tras el inicio, use «KuentaPOS → Importar datos de KFZ-Faktura» o «Restaurar datos». El idioma se cambia en KuentaPOS en «KuentaPOS → Sprache / Language».
de.FinishedLabel=KuentaPOS wurde installiert.%n%nIhre Daten werden im Benutzerprofil gespeichert (AppData\Roaming\KuentaPOS) und bleiben bei Updates erhalten. Bei der Deinstallation entscheiden Sie, ob sie erhalten bleiben. Vorhandene Daten übernehmen Sie nach dem Start über „KuentaPOS → Daten aus KFZ-Faktura importieren“ oder „Daten wiederherstellen“.

[Code]
var
  KuentaPOSLief: Integer; { 0 = not running, 1 = running locally, 2 = running in network mode }
  Wartung: TInputOptionWizardPage; { installed already: update or uninstall }
  AltUninst, AltVersion: String;
  Beenden: Boolean;

{ ---------- an installed version: offer update or uninstall ---------- }
function UninstallKey: String;
begin
  Result := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{' + '{#AppGuid}' + '}_is1';
end;

function Installiert(var Uninst, Version: String): Boolean;
begin
  Result := False;
  if IsWin64 and RegQueryStringValue(HKLM64, UninstallKey, 'UninstallString', Uninst) then Result := True
  else if RegQueryStringValue(HKLM32, UninstallKey, 'UninstallString', Uninst) then Result := True
  else if RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', Uninst) then Result := True;
  if Result then
  begin
    if not (RegQueryStringValue(HKLM64, UninstallKey, 'DisplayVersion', Version) or RegQueryStringValue(HKLM32, UninstallKey, 'DisplayVersion', Version) or RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', Version)) then Version := '?';
    Uninst := RemoveQuotes(Uninst);
  end;
end;

procedure InitializeWizard;
begin
  Beenden := False;
  if WizardSilent or not Installiert(AltUninst, AltVersion) then exit;
  Wartung := CreateInputOptionPage(wpWelcome, CustomMessage('MaintTitle'), FmtMessage(CustomMessage('MaintSub'), [AltVersion]), CustomMessage('MaintWhat'), True, False);
  Wartung.Add(FmtMessage(CustomMessage('MaintUpdate'), [AltVersion]));
  Wartung.Add(CustomMessage('MaintRemove'));
  Wartung.SelectedValueIndex := 0;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Rc: Integer;
begin
  Result := True;
  if (Wartung <> nil) and (CurPageID = Wartung.ID) and (Wartung.SelectedValueIndex = 1) then
  begin
    Result := False;
    if not FileExists(AltUninst) then
    begin
      MsgBox(CustomMessage('MaintNoUninst'), mbError, MB_OK);
      exit;
    end;
    { the uninstaller asks for confirmation and whether to keep the data }
    Exec(AltUninst, '', '', SW_SHOW, ewWaitUntilTerminated, Rc);
    Beenden := True;
    WizardForm.Close;
  end;
end;

procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if Beenden then
  begin
    Cancel := True;
    Confirm := False;
  end;
end;

function StopKuentaPOS(Script, AppDir: String): Integer;
var
  Rc: Integer;
begin
  Result := 0;
  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
          '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Script + '" -AppDir "' + AppDir + '"',
          '', SW_HIDE, ewWaitUntilTerminated, Rc) then
    if (Rc = 1) or (Rc = 2) then Result := Rc;
end;

{ Before copying: stop a running KuentaPOS from the program folder }
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  KuentaPOSLief := 0;
  if DirExists(ExpandConstant('{app}')) then
  begin
    ExtractTemporaryFile('stop-kuentapos.ps1');
    KuentaPOSLief := StopKuentaPOS(ExpandConstant('{tmp}\stop-kuentapos.ps1'), ExpandConstant('{app}'));
    if KuentaPOSLief > 0 then Log('Running KuentaPOS was stopped (mode ' + IntToStr(KuentaPOSLief) + ').');
  end;
end;

{ Do not restart with /NOSTART or when deployed as the system account (KuentaPOS would otherwise run in the wrong user profile) }
function NeustartErlaubt: Boolean;
var
  U: String;
begin
  U := Uppercase(GetUserNameString);
  Result := (Pos('/NOSTART', Uppercase(GetCmdTail)) = 0) and (U <> 'SYSTEM') and (Copy(U, Length(U), 1) <> '$');
end;

function NeuStarten(Modus: Integer): Boolean;
begin
  Result := (KuentaPOSLief = Modus) and NeustartErlaubt;
end;

function NichtNeuStarten: Boolean;
begin
  Result := not ((KuentaPOSLief > 0) and NeustartErlaubt);
end;

{ ---------- uninstall: optionally delete the data, after a copy on the desktop ---------- }
{ data folder of KuentaPOS: KUENTAPOS_DATA, otherwise AppData\Roaming\KuentaPOS of the current user (as server/db/index.js) }
function DatenOrdner: String;
begin
  Result := GetEnv('KUENTAPOS_DATA');
  if Result = '' then Result := GetEnv('KUENTA_DATA');
  if Result = '' then Result := ExpandConstant('{userappdata}\{#DataName}');
  { up to version 1.8.2 the folder was called Kuenta: it is used if only that one exists }
  if (CompareText(Result, ExpandConstant('{userappdata}\{#DataName}')) = 0) and not DirExists(Result) and DirExists(ExpandConstant('{userappdata}\Kuenta')) then
    Result := ExpandConstant('{userappdata}\Kuenta');
  Result := RemoveBackslashUnlessRoot(Result);
end;

{ only a folder that really holds KuentaPOS data is ever deleted (never a drive or the user profile) }
function SindKuentaPOSDaten(Dir: String): Boolean;
begin
  Result := (Length(Dir) > 8) and DirExists(Dir) and (FileExists(Dir + '\kuenta.db') or FileExists(Dir + '\mandanten.json'))
    and (CompareText(Dir, RemoveBackslashUnlessRoot(GetEnv('USERPROFILE'))) <> 0) and (CompareText(Dir, RemoveBackslashUnlessRoot(ExpandConstant('{userappdata}'))) <> 0);
end;

{ ZIP copy of the whole data folder on the desktop (.NET ZipFile, no size limit of Compress-Archive) }
function KopieAnlegen(Dir: String; var Ziel: String): Boolean;
var
  Rc: Integer;
  Q, Z: String;
begin
  Ziel := ExpandConstant('{userdesktop}\{#DataName}-Daten-') + GetDateTimeString('yyyy-mm-dd_hhnn', '-', '-') + '.zip';
  Q := Dir; StringChangeEx(Q, '''', '''''', True);
  Z := Ziel; StringChangeEx(Z, '''', '''''', True);
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference=''Stop''; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(''' + Q + ''', ''' + Z + ''', [IO.Compression.CompressionLevel]::Optimal, $true)"',
    '', SW_HIDE, ewWaitUntilTerminated, Rc) and (Rc = 0) and FileExists(Ziel);
  Log('Copy of the data: ' + Ziel + ' (exit code ' + IntToStr(Rc) + ')');
  { an incomplete ZIP must not look like a backup }
  if not Result and FileExists(Ziel) then DeleteFile(Ziel);
end;

procedure DatenEntfernen;
var
  Dir, Ziel, Tail: String;
  Kopie: Boolean;
begin
  Dir := DatenOrdner;
  if not SindKuentaPOSDaten(Dir) then exit;
  Tail := Uppercase(GetCmdTail);
  if UninstallSilent then
  begin
    { silent: only with /DELETEDATA; a copy is made unless /NOBACKUP }
    if Pos('/DELETEDATA', Tail) = 0 then exit;
    Kopie := Pos('/NOBACKUP', Tail) = 0;
  end else
  begin
    if MsgBox(FmtMessage(CustomMessage('DelDataAsk'), [Dir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) <> IDYES then exit;
    case MsgBox(CustomMessage('DelDataBackup'), mbConfirmation, MB_YESNOCANCEL) of
      IDYES: Kopie := True;
      IDNO:
        begin
          if MsgBox(CustomMessage('DelDataNoBackup'), mbError, MB_YESNO or MB_DEFBUTTON2) <> IDYES then exit;
          Kopie := False;
        end;
    else
      exit;
    end;
  end;
  Ziel := '';
  if Kopie and not KopieAnlegen(Dir, Ziel) then
  begin
    Log('Data kept: the copy failed.');
    if not UninstallSilent then MsgBox(FmtMessage(CustomMessage('DelDataBackupFailed'), [Dir]), mbError, MB_OK);
    exit;
  end;
  if DelTree(Dir, True, True, True) then
  begin
    Log('Data folder deleted: ' + Dir);
    if not UninstallSilent then
      if Ziel <> '' then MsgBox(CustomMessage('DelDataDone') + #13#10#13#10 + FmtMessage(CustomMessage('DelDataCopy'), [Ziel]), mbInformation, MB_OK)
      else MsgBox(CustomMessage('DelDataDone'), mbInformation, MB_OK);
  end else
  begin
    Log('Data folder could not be deleted completely: ' + Dir);
    if not UninstallSilent then MsgBox(FmtMessage(CustomMessage('DelDataFailed'), [Dir]), mbError, MB_OK);
  end;
end;

{ Stop it before uninstalling as well; afterwards ask about the data }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and FileExists(ExpandConstant('{app}\stop-kuentapos.ps1')) then
    StopKuentaPOS(ExpandConstant('{app}\stop-kuentapos.ps1'), ExpandConstant('{app}'));
  if CurUninstallStep = usPostUninstall then DatenEntfernen;
end;
