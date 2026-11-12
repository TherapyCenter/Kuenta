'use strict';
// Checks whether the data folder is on a network drive. The SQLite database can get
// corrupted there (locking and WAL do not work reliably over SMB/NFS).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const NETZ_TYPEN = /^(nfs\d?|cifs|smb\d?|smbfs|afpfs|webdav|fuse\.sshfs|9p|davfs)$/i;

// find the mount point with the longest matching prefix (Linux/macOS)
function typAusMounts(dir, mounts) {
  let best = null;
  for (const m of mounts) {
    const mp = m.mount.endsWith('/') ? m.mount : m.mount + '/';
    if ((dir + '/').startsWith(mp) && (!best || m.mount.length > best.mount.length)) best = m;
  }
  return best ? best.type : null;
}

function istNetzlaufwerk(dir) {
  return new Promise(resolve => {
    let real = dir;
    try { real = fs.realpathSync(dir); } catch { /* folder does not exist yet */ }
    if (process.platform === 'win32') {
      if (/^\\\\/.test(real)) return resolve(true); // UNC path \\server\share
      const drive = /^([a-z]):/i.exec(real);
      if (!drive) return resolve(false);
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[System.IO.DriveInfo]::new('${drive[1]}:\\').DriveType`],
        { timeout: 15000, windowsHide: true }, (err, out) => resolve(!err && /Network/i.test(String(out))));
    } else if (process.platform === 'linux') {
      fs.readFile('/proc/mounts', 'utf8', (err, txt) => {
        if (err) return resolve(false);
        const mounts = txt.split('\n').map(l => l.split(' ')).filter(p => p.length > 2).map(p => ({ mount: p[1].replace(/\\040/g, ' '), type: p[2] }));
        resolve(NETZ_TYPEN.test(typAusMounts(real, mounts) || ''));
      });
    } else if (process.platform === 'darwin') {
      execFile('mount', { timeout: 10000 }, (err, out) => {
        if (err) return resolve(false);
        const mounts = String(out).split('\n').map(l => /^.+? on (.+) \(([^,)]+)/.exec(l)).filter(Boolean).map(m => ({ mount: m[1], type: m[2] }));
        resolve(NETZ_TYPEN.test(typAusMounts(real, mounts) || ''));
      });
    } else resolve(false);
  });
}

async function warnung(dir) {
  const netz = await istNetzlaufwerk(path.resolve(dir)).catch(() => false);
  if (!netz) return null;
  return `Der Datenordner liegt auf einem Netzlaufwerk (${dir}). Dort kann die KuentaPOS-Datenbank beschädigt werden. `
    + 'Bitte einen Ordner auf einer lokalen Festplatte verwenden (Umgebungsvariable KUENTAPOS_DATA entfernen oder ändern) und für mehrere Arbeitsplätze den Netzwerkbetrieb nutzen. Sicherungen dürfen auf dem Netzlaufwerk liegen.';
}

module.exports = { warnung, istNetzlaufwerk, typAusMounts };
