'use strict';
// SMTP sending without third-party packages (SSL/TLS, STARTTLS, AUTH PLAIN/LOGIN, MIME with attachments)
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const os = require('os');
const L = require('./lib');

function settings() {
  return {
    host: L.sw('smtp.host', ''), port: Number(L.sw('smtp.port', '587')) || 587,
    secure: L.sw('smtp.sicherheit', 'starttls'), user: L.sw('smtp.benutzer', ''), pass: L.sw('smtp.passwort', ''),
    from: L.sw('smtp.absender', '') || L.firma().EMAIL || '', fromName: L.sw('smtp.absendername', '') || L.firma().FIRMENNAME || '',
    bcc: L.sw('smtp.bcc', ''), rejectUnauthorized: L.sw('smtp.zertifikatpruefen', '1') === '1',
  };
}

const enc = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
const b64lines = buf => buf.toString('base64').replace(/.{1,76}/g, '$&\r\n');
const addrList = s => String(s || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);

function buildMessage({ from, fromName, to, cc, bcc, subject, text, html, attachments = [], unsent }) {
  const boundary = 'sw_' + crypto.randomBytes(12).toString('hex');
  const domain = (String(from || '').split('@')[1] || 'localhost').replace(/[^\w.-]/g, '');
  const head = [
    from ? `From: ${fromName ? `${enc(fromName)} <${from}>` : from}` : null,
    `To: ${addrList(to).join(', ')}`,
    cc ? `Cc: ${addrList(cc).join(', ')}` : null,
    unsent && bcc ? `Bcc: ${addrList(bcc).join(', ')}` : null,
    `Subject: ${enc(subject || '')}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    'X-Mailer: KuentaPOS',
    unsent ? 'X-Unsent: 1' : null,
  ].filter(Boolean).join('\r\n');
  const parts = [];
  if (html) {
    const alt = 'alt_' + crypto.randomBytes(8).toString('hex');
    parts.push(`Content-Type: multipart/alternative; boundary="${alt}"\r\n\r\n--${alt}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(text || '', 'utf8'))}--${alt}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(html, 'utf8'))}--${alt}--`);
  } else parts.push(`Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(Buffer.from(text || '', 'utf8'))}`);
  for (const a of attachments) {
    const fn = a.filename.replace(/["\r\n]/g, '');
    parts.push(`Content-Type: ${a.contentType || 'application/octet-stream'}; name="${enc(fn)}"\r\nContent-Disposition: attachment; filename="${enc(fn)}"; filename*=UTF-8''${encodeURIComponent(fn)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64lines(a.content)}`);
  }
  return `${head}\r\n\r\n` + parts.map(p => `--${boundary}\r\n${p}\r\n`).join('') + `--${boundary}--\r\n`;
}

class SmtpConn {
  constructor(sock) { this.setSocket(sock); this.buf = ''; this.waiters = []; }
  setSocket(sock) {
    this.sock = sock;
    sock.setEncoding('utf8');
    sock.on('data', d => { this.buf += d; this.flush(); });
    sock.on('error', e => { this.error = e; this.flush(); });
    sock.on('close', () => { this.closed = true; this.flush(); });
  }
  flush() {
    while (this.waiters.length) {
      if (this.error) { this.waiters.shift().rej(this.error); continue; }
      const m = this.buf.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n/);
      if (!m) { if (this.closed) this.waiters.shift().rej(new Error('Verbindung vom Mailserver geschlossen')); return; }
      const end = m.index + m[0].length;
      const resp = this.buf.slice(0, end); this.buf = this.buf.slice(end);
      this.waiters.shift().res({ code: Number(m[2]), text: resp.trim() });
    }
  }
  read() { return new Promise((res, rej) => { this.waiters.push({ res, rej }); this.flush(); }); }
  async cmd(line, expect) {
    if (line != null) this.sock.write(line + '\r\n');
    const r = await this.read();
    if (expect && !expect.includes(r.code)) {
      const shown = line && /^AUTH|^[A-Za-z0-9+/=]{8,}$/.test(line) ? '(Anmeldung)' : (line || 'Verbindung');
      const e = new Error(`Mailserver-Fehler bei ${shown}: ${r.text.replace(/\r\n/g, ' ')}`); e.smtp = r.code; throw e;
    }
    return r;
  }
}

function connect(s) {
  return new Promise((resolve, reject) => {
    const opts = { host: s.host, port: s.port, servername: s.host, rejectUnauthorized: s.rejectUnauthorized };
    const sock = s.secure === 'ssl' ? tls.connect(opts) : net.connect(opts);
    const t = setTimeout(() => { sock.destroy(); reject(new Error(`Keine Verbindung zu ${s.host}:${s.port} (Zeitüberschreitung)`)); }, 20000);
    sock.once(s.secure === 'ssl' ? 'secureConnect' : 'connect', () => { clearTimeout(t); resolve(sock); });
    sock.once('error', e => { clearTimeout(t); reject(new Error(`Verbindung zu ${s.host}:${s.port} fehlgeschlagen: ${e.message}`)); });
  });
}

async function send(mail, override) {
  // With a complete override (host) it works without the KuentaPOS database, e.g. from the license tool
  const s = override && override.host ? { port: 587, secure: 'starttls', rejectUnauthorized: true, user: '', pass: '', fromName: '', bcc: '', ...override } : { ...settings(), ...(override || {}) };
  if (!s.host) throw new L.HttpError(400, 'Es ist kein Mailserver eingerichtet (Einstellungen → E-Mail).');
  if (!s.from) throw new L.HttpError(400, 'Es ist keine Absenderadresse eingerichtet (Einstellungen → E-Mail).');
  const rcpts = [...addrList(mail.to), ...addrList(mail.cc), ...addrList(mail.bcc || s.bcc)];
  if (!addrList(mail.to).length) throw new L.HttpError(400, 'Bitte einen Empfänger angeben.');
  const msg = buildMessage({ ...mail, from: s.from, fromName: s.fromName });
  const c = new SmtpConn(await connect(s));
  const host = os.hostname().replace(/[^\w.-]/g, '') || 'kuentapos';
  try {
    await c.cmd(null, [220]);
    let ehlo = await c.cmd(`EHLO ${host}`, [250]);
    if (s.secure === 'starttls') {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('Der Mailserver unterstützt kein STARTTLS.');
      await c.cmd('STARTTLS', [220]);
      const secured = await new Promise((res, rej) => { const t = tls.connect({ socket: c.sock, servername: s.host, rejectUnauthorized: s.rejectUnauthorized }, () => res(t)); t.once('error', rej); });
      c.sock.removeAllListeners('data'); c.setSocket(secured);
      ehlo = await c.cmd(`EHLO ${host}`, [250]);
    }
    if (s.user) {
      if (/AUTH[ =][^\r\n]*PLAIN/i.test(ehlo.text)) await c.cmd('AUTH PLAIN ' + Buffer.from(`\0${s.user}\0${s.pass}`).toString('base64'), [235]);
      else {
        await c.cmd('AUTH LOGIN', [334]);
        await c.cmd(Buffer.from(s.user).toString('base64'), [334]);
        await c.cmd(Buffer.from(s.pass).toString('base64'), [235]);
      }
    }
    await c.cmd(`MAIL FROM:<${s.from}>`, [250]);
    for (const r of rcpts) await c.cmd(`RCPT TO:<${r}>`, [250, 251]);
    await c.cmd('DATA', [354]);
    c.sock.write(msg.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
    await c.cmd(null, [250]);
    await c.cmd('QUIT').catch(() => {});
  } finally { c.sock.end(); }
  return { ok: true, empfaenger: rcpts.length };
}

function log(entry) {
  try {
    L.db().prepare('INSERT INTO SW_MAILS (ZEIT, AN, BETREFF, BEZUG, BEZUGID, ANHAENGE, STATUS, FEHLER, BENUTZER) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(L.now(), entry.to, entry.subject, entry.bezug || null, entry.bezugId || null, entry.anhaenge || null, entry.status, entry.fehler || null, entry.user || null);
  } catch { /* ignore */ }
}

module.exports = { send, settings, buildMessage, log };
