'use strict';
// Minimal ICC v2 sRGB colour profile (matrix/TRC) for the PDF/A OutputIntent
let cached = null;
function s15(v) { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(v * 65536)); return b; }
function xyz(x, y, z) { return Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), s15(x), s15(y), s15(z)]); }
function desc(text) {
  const a = Buffer.from(text + '\0', 'latin1');
  const h = Buffer.alloc(12); h.write('desc', 0, 'latin1'); h.writeUInt32BE(a.length, 8);
  return Buffer.concat([h, a, Buffer.alloc(4 + 4 + 2 + 1 + 67)]);
}
function srgbProfile() {
  if (cached) return cached;
  const curv = Buffer.from([0x63, 0x75, 0x72, 0x76, 0, 0, 0, 0, 0, 0, 0, 1, 0x02, 0x33]);
  const tags = [
    ['desc', desc('sRGB IEC61966-2.1')],
    ['cprt', Buffer.concat([Buffer.from('text\0\0\0\0', 'latin1'), Buffer.from('Public Domain\0', 'latin1')])],
    ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.4361, 0.2225, 0.0139)],
    ['gXYZ', xyz(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', curv], ['gTRC', curv], ['bTRC', curv],
  ];
  const tableLen = 4 + tags.length * 12;
  let off = 128 + tableLen; const datas = []; const table = Buffer.alloc(tableLen);
  table.writeUInt32BE(tags.length, 0);
  tags.forEach(([sig, data], i) => {
    while (off % 4) off++;
    table.write(sig, 4 + i * 12, 'latin1'); table.writeUInt32BE(off, 8 + i * 12); table.writeUInt32BE(data.length, 12 + i * 12);
    datas.push({ off, data }); off += data.length;
  });
  const total = off + ((4 - off % 4) % 4);
  const buf = Buffer.alloc(total);
  buf.writeUInt32BE(total, 0); buf.writeUInt32BE(0x02100000, 8);
  buf.write('mntr', 12, 'latin1'); buf.write('RGB ', 16, 'latin1'); buf.write('XYZ ', 20, 'latin1');
  const d = new Date(); [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, 0].forEach((v, i) => buf.writeUInt16BE(v, 24 + i * 2));
  buf.write('acsp', 36, 'latin1');
  s15(0.9642).copy(buf, 68); s15(1.0).copy(buf, 72); s15(0.8249).copy(buf, 76);
  table.copy(buf, 128);
  for (const { off: o, data } of datas) data.copy(buf, o);
  cached = buf;
  return buf;
}
module.exports = { srgbProfile };
