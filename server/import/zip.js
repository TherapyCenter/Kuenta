'use strict';
// Minimal ZIP reader/writer (stored + deflate, PKWARE "ZipCrypto" decryption, ZIP64 read).
const zlib = require('zlib');

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

// ---------- ZipCrypto ----------
function crcByte(crc, b) { return (CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0; }
class ZipCrypto {
  constructor(password) {
    this.k0 = 0x12345678; this.k1 = 0x23456789; this.k2 = 0x34567890;
    for (const b of Buffer.from(password, 'latin1')) this.update(b);
  }
  update(b) {
    this.k0 = crcByte(this.k0, b);
    this.k1 = (Math.imul((this.k1 + (this.k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    this.k2 = crcByte(this.k2, this.k1 >>> 24);
  }
  streamByte() { const t = (this.k2 | 2) & 0xffff; return (Math.imul(t, t ^ 1) >>> 8) & 0xff; }
  decrypt(buf) {
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) { const c = buf[i] ^ this.streamByte(); this.update(c); out[i] = c; }
    return out;
  }
  encrypt(buf) {
    const out = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) { const p = buf[i]; out[i] = p ^ this.streamByte(); this.update(p); }
    return out;
  }
}

function isZip(buf) { return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50; }
function is7z(buf) { return buf.length > 6 && buf.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])); }

function readZip(buf) {
  // find end of central directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP-Verzeichnis nicht gefunden (Datei beschädigt oder unvollständig)');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      count = Number(buf.readBigUInt64LE(z64 + 32));
      cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const crc = buf.readUInt32LE(p + 16);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    let lho = buf.readUInt32LE(p + 42);
    const nameRaw = buf.subarray(p + 46, p + 46 + nlen);
    const name = (flags & 0x800 ? nameRaw.toString('utf8') : new TextDecoder('ibm850').decode(nameRaw)).replace(/\\/g, '/');
    // zip64 extra
    let x = p + 46 + nlen; const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    entries.push({ name, flags, method, crc, csize, usize, lho, time, dir: name.endsWith('/') });
    p += 46 + nlen + xlen + clen;
  }
  return {
    entries,
    encrypted: entries.some(e => e.flags & 1),
    read(entry, password) {
      const h = entry.lho;
      if (buf.readUInt32LE(h) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + entry.name);
      const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
      let data = buf.subarray(start, start + entry.csize);
      if (entry.flags & 1) {
        if (entry.method === 99) throw new Error('AES-verschlüsselte ZIP-Dateien werden nicht unterstützt');
        if (!password) { const e = new Error('Die Sicherung ist mit einem Passwort geschützt.'); e.code = 'PASSWORD'; throw e; }
        const zc = new ZipCrypto(password);
        const hdr = zc.decrypt(data.subarray(0, 12));
        const check = entry.flags & 8 ? (entry.time >>> 8) & 0xff : entry.crc >>> 24;
        if (hdr[11] !== check) { const e = new Error('Falsches Passwort für die Sicherung.'); e.code = 'PASSWORD'; throw e; }
        data = zc.decrypt(data.subarray(12));
      }
      let out;
      if (entry.method === 0) out = Buffer.from(data);
      else if (entry.method === 8) out = zlib.inflateRawSync(data);
      else throw new Error(`ZIP-Kompressionsmethode ${entry.method} nicht unterstützt (${entry.name})`);
      if (crc32(out) !== entry.crc) {
        if (entry.flags & 1) { const e = new Error('Falsches Passwort für die Sicherung.'); e.code = 'PASSWORD'; throw e; }
        throw new Error('Prüfsummenfehler in ' + entry.name);
      }
      return out;
    },
  };
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// files: [{name, data(Buffer)}]; opts.password -> ZipCrypto (compatible with KFZ-Faktura restore)
function writeZip(files, opts = {}) {
  const parts = []; const central = []; let offset = 0;
  const { time, date } = dosDateTime();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = f.data;
    const crc = crc32(raw);
    let comp = raw.length > 64 ? zlib.deflateRawSync(raw, { level: 6 }) : raw;
    let method = comp === raw ? 0 : 8;
    if (method === 8 && comp.length >= raw.length) { comp = raw; method = 0; }
    let flags = 0x800;
    if (opts.password) {
      flags |= 1;
      const zc = new ZipCrypto(opts.password);
      const hdr = require('crypto').randomBytes(12); hdr[11] = crc >>> 24;
      comp = Buffer.concat([zc.encrypt(hdr), zc.encrypt(comp)]);
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

module.exports = { readZip, writeZip, isZip, is7z, crc32 };
