'use strict';
// Hands an email over to the mail program on this computer (e.g. Thunderbird).
// The mail is opened there and sent by the user, so afterwards it is in the
// "Sent" folder of the mail program.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync, exec } = require('child_process');
const { pathToFileURL } = require('url');
const L = require('./lib');
const dbm = require('./db');
const MAIL = require('./mail');

const OUT_DIR = () => path.join(dbm.ROOT, 'mail-ausgang');
const KEEP_DAYS = 14;

// find Thunderbird: configured path, otherwise registry/default folders/PATH
function findThunderbird() {
  const own = L.sw('mail.programm', '').trim().replace(/^"|"$/g, '');
  if (own) return fs.existsSync(own) ? own : null;
  const cands = [];
  if (process.platform === 'win32') {
    for (const key of ['HKCU\\SOFTWARE\\Clients\\Mail\\Mozilla Thunderbird\\shell\\open\\command',
      'HKLM\\SOFTWARE\\Clients\\Mail\\Mozilla Thunderbird\\shell\\open\\command',
      'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\Mail\\Mozilla Thunderbird\\shell\\open\\command']) {
      try {
        const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/"([^"]+\.exe)"/i) || out.match(/REG_\w+\s+(\S+\.exe)/i);
        if (m) cands.push(m[1]);
      } catch { /* key missing */ }
    }
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.LOCALAPPDATA])
      if (base) cands.push(path.join(base, 'Mozilla Thunderbird', 'thunderbird.exe'));
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Thunderbird.app/Contents/MacOS/thunderbird', path.join(os.homedir(), 'Applications/Thunderbird.app/Contents/MacOS/thunderbird'));
  } else {
    for (const dir of String(process.env.PATH || '').split(':')) if (dir) cands.push(path.join(dir, 'thunderbird'));
    cands.push('/usr/bin/thunderbird', '/snap/bin/thunderbird', '/var/lib/flatpak/exports/bin/org.mozilla.Thunderbird');
  }
  return cands.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// values in the -compose argument are in single quotes and must not contain any themselves
const q = s => String(s || '').replace(/'/g, '’').replace(/[\r\n]+/g, ' ');
const addrs = s => String(s || '').split(/[;,]/).map(x => x.trim()).filter(Boolean).join(',');

function composeArg({ to, cc, bcc, subject, bodyFile, files = [] }) {
  const parts = [`to='${q(addrs(to))}'`];
  if (addrs(cc)) parts.push(`cc='${q(addrs(cc))}'`);
  if (addrs(bcc)) parts.push(`bcc='${q(addrs(bcc))}'`);
  parts.push(`subject='${q(subject)}'`);
  if (bodyFile) parts.push(`message='${bodyFile}'`);
  if (files.length) parts.push(`attachment='${files.map(f => pathToFileURL(f).href).join(',')}'`);
  return parts.join(',');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textToHtml = t => `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${esc(t || '').replace(/\r?\n/g, '<br>\n')}</body></html>`;
const safeName = s => String(s).replace(/[\\/:*?"<>|,'\r\n]/g, '_').slice(0, 150) || 'Anhang';

function cleanup() {
  try {
    const limit = Date.now() - KEEP_DAYS * 864e5;
    for (const d of fs.readdirSync(OUT_DIR())) {
      const p = path.join(OUT_DIR(), d);
      if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* folder missing */ }
}

function openFile(p) {
  if (process.platform === 'win32') exec(`start "" "${p}"`, { windowsHide: true });
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
}

// Does the request come from the Kuenta computer itself? Only there can the mail program open.
function isLocalRequest(req) {
  const a = String((req && req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  if (!a || a === '::1' || a.startsWith('127.')) return true;
  return Object.values(os.networkInterfaces()).flat().some(i => i && i.address === a);
}

// Opens a mail window with recipient, subject, text and attachments
function open(mail) {
  if (process.env.KUENTA_CONTAINER) throw new L.HttpError(400, 'Kuenta läuft in einem Container. Dort gibt es kein Mailprogramm – bitte unter Einstellungen → E-Mail den direkten Versand (SMTP) wählen.');
  cleanup();
  const dir = path.join(OUT_DIR(), new Date().toISOString().replace(/[:.]/g, '-') + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  const used = new Set();
  const files = (mail.attachments || []).map(a => {
    let n = safeName(a.filename), i = 1;
    while (used.has(n.toLowerCase())) n = safeName(a.filename).replace(/(\.[^.]*)?$/, `_${++i}$1`);
    used.add(n.toLowerCase());
    const p = path.join(dir, n); fs.writeFileSync(p, a.content); return p;
  });
  const bcc = mail.bcc || L.sw('smtp.bcc', '');
  const tb = findThunderbird();
  if (tb) {
    const bodyFile = path.join(dir, 'nachricht.html');
    fs.writeFileSync(bodyFile, textToHtml(mail.text));
    spawn(tb, ['-compose', composeArg({ ...mail, bcc, bodyFile, files })], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { programm: 'Thunderbird' };
  }
  if (L.sw('mail.programm', '').trim()) throw new L.HttpError(400, 'Das eingestellte Mailprogramm wurde nicht gefunden (Einstellungen → E-Mail).');
  // No Thunderbird: draft as .eml for the default mail program (Outlook and others open it for editing)
  const s = MAIL.settings();
  const eml = MAIL.buildMessage({ ...mail, bcc, from: s.from, fromName: s.fromName, unsent: true });
  const emlFile = path.join(dir, safeName(mail.subject || 'E-Mail') + '.eml');
  fs.writeFileSync(emlFile, eml);
  openFile(emlFile);
  return { programm: 'Standard-Mailprogramm' };
}

module.exports = { open, findThunderbird, composeArg, textToHtml, isLocalRequest };
