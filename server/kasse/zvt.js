'use strict';
// Card terminal via ZVT (TCP/IP): registration (06 00) and authorisation (06 01)
const net = require('net');
const L = require('../lib');

const bcd = (n, len) => { const s = String(n).padStart(len * 2, '0'); return Buffer.from(s, 'hex'); };
function apdu(cls, ins, data = Buffer.alloc(0)) {
  const len = data.length < 255 ? Buffer.from([data.length]) : Buffer.from([0xff, data.length & 0xff, data.length >> 8]);
  return Buffer.concat([Buffer.from([cls, ins]), len, data]);
}
const ACK = Buffer.from([0x80, 0x00, 0x00]);
const FEHLER = { 0x64: 'Karte nicht lesbar', 0x6c: 'Abbruch durch Kunde', 0x6f: 'falsche Währung', 0x9c: 'Abbruch am Terminal', 0x67: 'Karte abgelaufen', 0x63: 'PIN falsch', 0x68: 'Zeitüberschreitung' };

function cfg() { return { aktiv: L.sw('ec.aktiv', '0') === '1', host: L.sw('ec.ip', ''), port: Number(L.sw('ec.port', '20007')) || 20007, passwort: L.sw('ec.passwort', '000000'), ohneAnmeldung: L.sw('ec.ohneanmeldung', '0') === '1' }; }

function session(c, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: c.host, port: c.port });
    let buf = Buffer.alloc(0); const waiters = [];
    const t = setTimeout(() => { sock.destroy(); reject(new Error('EC-Terminal: Zeitüberschreitung')); }, timeoutMs);
    const pump = () => {
      while (waiters.length && buf.length >= 3) {
        let len = buf[2], hdr = 3;
        if (len === 0xff) { if (buf.length < 5) return; len = buf.readUInt16LE(3); hdr = 5; }
        if (buf.length < hdr + len) return;
        const msg = { cls: buf[0], ins: buf[1], data: buf.subarray(hdr, hdr + len) };
        buf = buf.subarray(hdr + len);
        waiters.shift()(msg);
      }
    };
    sock.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
    sock.on('error', e => { clearTimeout(t); reject(new Error('EC-Terminal nicht erreichbar: ' + e.message)); });
    sock.on('connect', () => resolve({
      send: b => sock.write(b),
      read: () => new Promise(r => { waiters.push(r); pump(); }),
      end: () => { clearTimeout(t); sock.end(); },
    }));
  });
}

async function command(s, cmd) {
  s.send(cmd);
  const a = await s.read();
  if (!(a.cls === 0x80 && a.ins === 0x00)) {
    if (a.cls === 0x84) throw new Error('EC-Terminal lehnt den Befehl ab' + (FEHLER[a.ins] ? ': ' + FEHLER[a.ins] : ` (Code ${a.ins.toString(16)})`));
  }
  const belege = []; let ergebnis = null;
  for (;;) {
    const m = await s.read();
    if (m.cls === 0x04 && m.ins === 0xff) { s.send(ACK); continue; } // intermediate status
    if (m.cls === 0x04 && m.ins === 0x0f) { s.send(ACK); ergebnis = m.data; continue; } // status information
    if (m.cls === 0x06 && (m.ins === 0xd1 || m.ins === 0xd3)) { s.send(ACK); belege.push(m.data.toString('latin1').replace(/[^\x20-\xff]/g, '')); continue; }
    if (m.cls === 0x06 && m.ins === 0x0f) { s.send(ACK); return { ok: true, status: ergebnis, beleg: belege.join('\n') }; }
    if (m.cls === 0x06 && m.ins === 0x1e) { s.send(ACK); const code = m.data[0]; return { ok: false, fehler: FEHLER[code] || `Vorgang abgebrochen (Code ${code != null ? code.toString(16) : '?'})`, beleg: belege.join('\n') }; }
    s.send(ACK);
  }
}

async function zahlen(betrag) {
  const c = cfg();
  if (!c.host) throw new L.HttpError(400, 'EC-Terminal ist nicht eingerichtet (Einstellungen → Kasse).');
  const s = await session(c, 180000);
  try {
    if (!c.ohneAnmeldung) {
      const reg = await command(s, apdu(0x06, 0x00, Buffer.concat([bcd(c.passwort, 3), Buffer.from([0xba]), Buffer.from([0x09, 0x78])])));
      if (!reg.ok) throw new Error('Anmeldung am EC-Terminal fehlgeschlagen: ' + reg.fehler);
    }
    const cent = Math.round(Number(betrag) * 100);
    return await command(s, apdu(0x06, 0x01, Buffer.concat([Buffer.from([0x04]), bcd(cent, 6), Buffer.from([0x49, 0x09, 0x78])])));
  } finally { s.end(); }
}
async function test() {
  const c = cfg();
  const s = await session(c, 15000);
  try {
    const r = await command(s, apdu(0x06, 0x00, Buffer.concat([bcd(c.passwort, 3), Buffer.from([0xba]), Buffer.from([0x09, 0x78])])));
    return r.ok ? { ok: true, meldung: 'Verbindung zum EC-Terminal erfolgreich.' } : { ok: false, meldung: r.fehler };
  } finally { s.end(); }
}

module.exports = { zahlen, test, cfg, _apdu: apdu, _bcd: bcd };
