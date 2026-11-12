'use strict';
// Small PDF generator (PDF 1.7 / PDF/A-3b): embedded TrueType font (subset), JPEG/PNG, file attachments.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { srgbProfile } = require('./icc');

const MM = 72 / 25.4;

// ---------- Windows-1252 ----------
const CP1252_EXTRA = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
const CP1252_TO_UNI = {}; for (const [u, b] of Object.entries(CP1252_EXTRA)) CP1252_TO_UNI[b] = Number(u);
function toCp1252(str) {
  const out = [];
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    if (c === 9) { out.push(32); continue; }
    if (c < 0x20) continue;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else if (CP1252_EXTRA[c]) out.push(CP1252_EXTRA[c]);
    else if (c === 0x2212) out.push(0x2d);
    else out.push(0x3f);
  }
  return out;
}
const uniOf = b => (b >= 0x80 && b < 0xa0) ? (CP1252_TO_UNI[b] || 0x3f) : b;

// ---------- TrueType ----------
class TTF {
  constructor(file) {
    this.buf = fs.readFileSync(file);
    const b = this.buf; const n = b.readUInt16BE(4);
    this.tables = {};
    for (let i = 0; i < n; i++) {
      const o = 12 + i * 16;
      this.tables[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
    }
    const head = this.tables.head.off;
    this.unitsPerEm = b.readUInt16BE(head + 18);
    this.bbox = [b.readInt16BE(head + 36), b.readInt16BE(head + 38), b.readInt16BE(head + 40), b.readInt16BE(head + 42)];
    this.indexToLoc = b.readInt16BE(head + 50);
    const hhea = this.tables.hhea.off;
    this.ascent = b.readInt16BE(hhea + 4); this.descent = b.readInt16BE(hhea + 6);
    this.numHMetrics = b.readUInt16BE(hhea + 34);
    this.numGlyphs = b.readUInt16BE(this.tables.maxp.off + 4);
    const os2 = this.tables['OS/2'];
    this.capHeight = os2 && os2.len >= 90 ? b.readInt16BE(os2.off + 88) : Math.round(this.ascent * 0.7);
    this.parseCmap();
  }
  parseCmap() {
    const b = this.buf; const c = this.tables.cmap.off; const n = b.readUInt16BE(c + 2);
    let sub = null;
    for (let i = 0; i < n; i++) {
      const pid = b.readUInt16BE(c + 4 + i * 8), eid = b.readUInt16BE(c + 6 + i * 8), off = b.readUInt32BE(c + 8 + i * 8);
      if (pid === 3 && eid === 1) sub = c + off;
    }
    this.cmap = new Map();
    if (b.readUInt16BE(sub) !== 4) throw new Error('cmap Format 4 erwartet');
    const segX2 = b.readUInt16BE(sub + 6);
    const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const end = b.readUInt16BE(ends + i * 2), start = b.readUInt16BE(starts + i * 2), delta = b.readInt16BE(deltas + i * 2), ro = b.readUInt16BE(ranges + i * 2);
      for (let cc = start; cc <= end && cc !== 0xffff; cc++) {
        let g;
        if (ro === 0) g = (cc + delta) & 0xffff;
        else { g = b.readUInt16BE(ranges + i * 2 + ro + (cc - start) * 2); if (g) g = (g + delta) & 0xffff; }
        if (cc <= 0x2122) this.cmap.set(cc, g);
      }
    }
  }
  advance(gid) {
    const h = this.tables.hmtx.off;
    const i = Math.min(gid, this.numHMetrics - 1);
    return this.buf.readUInt16BE(h + i * 4);
  }
  glyphOf(uni) { return this.cmap.get(uni) || 0; }
  widthOfByte(byte) { return Math.round(this.advance(this.glyphOf(uniOf(byte))) * 1000 / this.unitsPerEm); }
  locaOffsets() {
    const b = this.buf; const l = this.tables.loca.off; const out = [];
    for (let i = 0; i <= this.numGlyphs; i++) out.push(this.indexToLoc ? b.readUInt32BE(l + i * 4) : b.readUInt16BE(l + i * 2) * 2);
    return out;
  }
  // subset: empty unused glyphs (glyph IDs stay the same)
  subset(usedGids) {
    const b = this.buf; const glyf = this.tables.glyf.off; const loca = this.locaOffsets();
    const keep = new Set([0, ...usedGids]);
    const stack = [...keep];
    while (stack.length) { // composite glyphs
      const g = stack.pop(); const s = glyf + loca[g], e = glyf + loca[g + 1];
      if (e - s < 10 || b.readInt16BE(s) >= 0) continue;
      let p = s + 10; let more = true;
      while (more) {
        const flags = b.readUInt16BE(p); const comp = b.readUInt16BE(p + 2);
        if (!keep.has(comp)) { keep.add(comp); stack.push(comp); }
        p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
        more = !!(flags & 0x20);
      }
    }
    const parts = []; const newLoca = [0]; let off = 0;
    for (let g = 0; g < this.numGlyphs; g++) {
      if (keep.has(g)) { const d = b.subarray(glyf + loca[g], glyf + loca[g + 1]); parts.push(d); off += d.length; if (off % 4) { const pad = 4 - (off % 4); parts.push(Buffer.alloc(pad)); off += pad; } }
      newLoca.push(off);
    }
    const glyfBuf = Buffer.concat(parts);
    const locaBuf = Buffer.alloc((this.numGlyphs + 1) * 4);
    newLoca.forEach((v, i) => locaBuf.writeUInt32BE(v, i * 4));
    const headBuf = Buffer.from(b.subarray(this.tables.head.off, this.tables.head.off + this.tables.head.len));
    headBuf.writeInt16BE(1, 50); headBuf.writeUInt32BE(0, 8);
    const tables = { head: headBuf, glyf: glyfBuf, loca: locaBuf };
    for (const t of ['cmap', 'hhea', 'hmtx', 'maxp', 'cvt ', 'fpgm', 'prep', 'name', 'OS/2', 'post']) if (this.tables[t]) tables[t] = b.subarray(this.tables[t].off, this.tables[t].off + this.tables[t].len);
    return buildFont(tables);
  }
}
function checksum(buf) {
  let s = 0; const padded = buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - buf.length % 4)]) : buf;
  for (let i = 0; i < padded.length; i += 4) s = (s + padded.readUInt32BE(i)) >>> 0;
  return s;
}
function buildFont(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length; let es = 0; while ((1 << (es + 1)) <= n) es++;
  const header = Buffer.alloc(12 + n * 16);
  header.writeUInt32BE(0x00010000, 0); header.writeUInt16BE(n, 4); header.writeUInt16BE((1 << es) * 16, 6); header.writeUInt16BE(es, 8); header.writeUInt16BE(n * 16 - (1 << es) * 16, 10);
  let off = header.length; const bodies = [];
  tags.forEach((t, i) => {
    const d = tables[t]; const o = 12 + i * 16;
    header.write(t.padEnd(4, ' '), o, 'latin1'); header.writeUInt32BE(checksum(d), o + 4); header.writeUInt32BE(off, o + 8); header.writeUInt32BE(d.length, o + 12);
    const pad = (4 - d.length % 4) % 4; bodies.push(d, Buffer.alloc(pad)); off += d.length + pad;
  });
  const font = Buffer.concat([header, ...bodies]);
  const headOff = font.readUInt32BE(12 + tags.indexOf('head') * 16 + 8);
  font.writeUInt32BE((0xB1B0AFBA - checksum(font)) >>> 0, headOff + 8);
  return font;
}

const FONT_DIR = path.join(__dirname, 'fonts');
const FONTS = {};
function font(name) {
  if (!FONTS[name]) FONTS[name] = new TTF(path.join(FONT_DIR, name === 'B' ? 'LiberationSans-Bold.ttf' : 'LiberationSans-Regular.ttf'));
  return FONTS[name];
}

// ---------- Images ----------
function parseJpeg(buf) {
  let p = 2;
  while (p < buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const m = buf[p + 1]; const len = buf.readUInt16BE(p + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xcb && m !== 0xc8)) {
      return { w: buf.readUInt16BE(p + 7), h: buf.readUInt16BE(p + 5), comps: buf[p + 9] };
    }
    p += 2 + len;
  }
  throw new Error('JPEG ungültig');
}
function parsePng(buf) {
  let p = 8; let ihdr; const idat = []; let plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') ihdr = { w: d.readUInt32BE(0), h: d.readUInt32BE(4), depth: d[8], ctype: d[9], interlace: d[12] };
    else if (type === 'PLTE') plte = Buffer.from(d);
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr || ihdr.interlace || ihdr.depth !== 8) throw new Error('PNG-Format nicht unterstützt (nur 8 Bit, ohne Interlace)');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.ctype];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch; const out = Buffer.alloc(stride * ihdr.h);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, up = y ? out[(y - 1) * stride + x] : 0, c = (y && x >= ch) ? out[(y - 1) * stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + x] = v & 0xff;
    }
  }
  const px = ihdr.w * ihdr.h;
  let color, alpha = null, cs = 'DeviceRGB', ncomp = 3;
  if (ihdr.ctype === 6 || ihdr.ctype === 4) {
    const cc = ch - 1; color = Buffer.alloc(px * cc); alpha = Buffer.alloc(px);
    for (let i = 0; i < px; i++) { out.copy(color, i * cc, i * ch, i * ch + cc); alpha[i] = out[i * ch + cc]; }
    if (cc === 1) { cs = 'DeviceGray'; ncomp = 1; }
    if (alpha.every(v => v === 255)) alpha = null;
  } else if (ihdr.ctype === 3) {
    color = Buffer.alloc(px * 3);
    for (let i = 0; i < px; i++) plte.copy(color, i * 3, out[i] * 3, out[i] * 3 + 3);
  } else if (ihdr.ctype === 0) { color = out; cs = 'DeviceGray'; ncomp = 1; } else color = out;
  return { w: ihdr.w, h: ihdr.h, color, alpha, cs, ncomp };
}

// ---------- Document ----------
class PDFDoc {
  constructor(opts = {}) {
    this.opts = opts; this.pages = []; this.objects = []; this.images = []; this.attachments = [];
    this.used = { R: new Set(), B: new Set() };
    this.W = 210; this.H = 297;
  }
  addPage() { const p = { ops: [] }; this.pages.push(p); this.page = p; return p; }
  // coordinates in mm, origin top left
  X(x) { return (x * MM).toFixed(2); }
  Y(y) { return ((this.H - y) * MM).toFixed(2); }
  width(text, f = 'R', size = 10) { const fn = font(f); return toCp1252(text).reduce((s, b) => s + fn.widthOfByte(b), 0) * size / 1000 / MM; }
  text(x, y, text, { f = 'R', size = 10, align = 'left', color } = {}) {
    const bytes = toCp1252(text);
    if (!bytes.length) return;
    for (const b of bytes) this.used[f].add(font(f).glyphOf(uniOf(b)));
    let xx = x; const w = this.width(text, f, size);
    if (align === 'right') xx = x - w; else if (align === 'center') xx = x - w / 2;
    const col = color ? `${color.map(c => (c / 255).toFixed(3)).join(' ')} rg ` : '0 0 0 rg ';
    this.page.ops.push(`BT ${col}/F${f} ${size} Tf ${this.X(xx)} ${this.Y(y)} Td <${Buffer.from(bytes).toString('hex')}> Tj ET`);
  }
  wrap(text, maxW, f = 'R', size = 10) {
    const lines = [];
    for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
      const words = para.split(/(\s+)/); let cur = '';
      for (const w of words) {
        const t = cur + w;
        if (this.width(t.trimEnd(), f, size) <= maxW || !cur.trim()) { cur = t; continue; }
        lines.push(cur.trimEnd()); cur = w.trimStart();
        while (this.width(cur, f, size) > maxW && cur.length > 1) { let i = cur.length; while (i > 1 && this.width(cur.slice(0, i), f, size) > maxW) i--; lines.push(cur.slice(0, i)); cur = cur.slice(i); }
      }
      lines.push(cur.trimEnd());
    }
    return lines;
  }
  line(x1, y1, x2, y2, { w = 0.3, color = [0, 0, 0] } = {}) { this.page.ops.push(`${color.map(c => (c / 255).toFixed(3)).join(' ')} RG ${(w).toFixed(2)} w ${this.X(x1)} ${this.Y(y1)} m ${this.X(x2)} ${this.Y(y2)} l S`); }
  rect(x, y, w, h, { fill, stroke, lw = 0.3 } = {}) {
    const ops = [];
    if (fill) ops.push(`${fill.map(c => (c / 255).toFixed(3)).join(' ')} rg`);
    if (stroke) ops.push(`${stroke.map(c => (c / 255).toFixed(3)).join(' ')} RG ${lw} w`);
    ops.push(`${this.X(x)} ${this.Y(y + h)} ${(w * MM).toFixed(2)} ${(h * MM).toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.page.ops.push(ops.join(' '));
  }
  image(buf, x, y, maxW, maxH) {
    let img;
    try {
      if (buf[0] === 0xff && buf[1] === 0xd8) { const j = parseJpeg(buf); if (j.comps === 4) return null; /* CMYK is not allowed in PDF/A */ img = { w: j.w, h: j.h, jpeg: buf, cs: j.comps === 1 ? 'DeviceGray' : 'DeviceRGB' }; }
      else if (buf.readUInt32BE(0) === 0x89504e47) img = parsePng(buf);
      else return null;
    } catch { return null; }
    const id = this.images.length; img.name = 'Im' + id; this.images.push(img);
    const s = Math.min(maxW / img.w, maxH / img.h);
    const w = img.w * s, h = img.h * s;
    this.page.ops.push(`q ${(w * MM).toFixed(2)} 0 0 ${(h * MM).toFixed(2)} ${this.X(x + (maxW - w))} ${this.Y(y + h)} cm /${img.name} Do Q`);
    return { w, h };
  }
  attach(name, data, { mime = 'text/xml', relationship = 'Alternative', description = '' } = {}) { this.attachments.push({ name, data, mime, relationship, description }); }

  // ---------- Output ----------
  save() {
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    const stream = (dict, data, compress = true) => {
      const d = compress ? zlib.deflateSync(data) : data;
      return { dict: `${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${d.length}`, data: d };
    };
    const now = new Date();
    const pdfDate = d => `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;
    const pdfStr = s => '(' + Buffer.from(toCp1252(s)).toString('latin1').replace(/[\\()]/g, m => '\\' + m) + ')';
    // fonts
    const fontRefs = {};
    for (const f of ['R', 'B']) {
      if (!this.used[f].size && f === 'B') continue;
      const t = font(f);
      const sub = t.subset(this.used[f]);
      const ff = add(stream(`<< /Length1 ${sub.length}`, sub)); // dict closed below
      objs[ff - 1].dict += ' >>';
      const sc = s => Math.round(s * 1000 / t.unitsPerEm);
      const tag = crypto.createHash('md5').update(f + [...this.used[f]].join(',')).digest('hex').slice(0, 6).toUpperCase().replace(/[0-9]/g, d => 'ABCDEFGHIJ'[d]);
      const base = `${tag}+LiberationSans${f === 'B' ? '-Bold' : ''}`;
      const fd = add(`<< /Type /FontDescriptor /FontName /${base} /Flags 32 /FontBBox [${t.bbox.map(sc).join(' ')}] /ItalicAngle 0 /Ascent ${sc(t.ascent)} /Descent ${sc(t.descent)} /CapHeight ${sc(t.capHeight)} /StemV ${f === 'B' ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      const widths = []; for (let c = 32; c <= 255; c++) widths.push(t.widthOfByte(c));
      fontRefs[f] = add(`<< /Type /Font /Subtype /TrueType /BaseFont /${base} /FirstChar 32 /LastChar 255 /Widths [${widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${fd} 0 R >>`);
    }
    // images
    const imgRefs = {};
    for (const img of this.images) {
      if (img.jpeg) imgRefs[img.name] = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.cs} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length}${img.cs === 'DeviceCMYK' ? ' /Decode [1 0 1 0 1 0 1 0]' : ''} >>`, data: img.jpeg });
      else {
        let smask = '';
        if (img.alpha) { const sm = add(stream(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8`, img.alpha)); objs[sm - 1].dict += ' >>'; smask = ` /SMask ${sm} 0 R`; }
        const io = add(stream(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.cs} /BitsPerComponent 8${smask}`, img.color)); objs[io - 1].dict += ' >>';
        imgRefs[img.name] = io;
      }
    }
    // pages
    const pagesId = add(null);
    const kids = [];
    const resources = `<< /Font << ${Object.entries(fontRefs).map(([k, v]) => `/F${k} ${v} 0 R`).join(' ')} >> /XObject << ${Object.entries(imgRefs).map(([k, v]) => `/${k} ${v} 0 R`).join(' ')} >> >>`;
    for (const p of this.pages) {
      const c = add(stream('<<', Buffer.from(p.ops.join('\n'), 'latin1'))); objs[c - 1].dict += ' >>';
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources ${resources} /Contents ${c} 0 R >>`));
    }
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    // attachments
    const fsRefs = [];
    for (const a of this.attachments) {
      const ef = add(stream(`<< /Type /EmbeddedFile /Subtype /${a.mime.replace('/', '#2F')} /Params << /ModDate ${pdfStr(pdfDate(now))} /Size ${a.data.length} >>`, a.data)); objs[ef - 1].dict += ' >>';
      fsRefs.push({ name: a.name, ref: add(`<< /Type /Filespec /F ${pdfStr(a.name)} /UF ${pdfStr(a.name)} /Desc ${pdfStr(a.description || a.name)} /AFRelationship /${a.relationship} /EF << /F ${ef} 0 R /UF ${ef} 0 R >> >>`) });
    }
    // metadata / PDF/A
    const title = this.opts.title || 'Dokument';
    const iso = now.toISOString().replace(/\.\d+Z$/, 'Z');
    const fx = this.opts.facturx;
    const xesc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xesc(title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${xesc(this.opts.author || 'KuentaPOS')}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>KuentaPOS</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>KuentaPOS PDF</pdf:Producer></rdf:Description>
${fx ? `<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${fx.filename}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${fx.level}</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#"><pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>` : ''}
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
    const meta = add(stream('<< /Type /Metadata /Subtype /XML', Buffer.from(xmp, 'utf8'), false)); objs[meta - 1].dict += ' >>';
    const icc = add(stream('<< /N 3', srgbProfile())); objs[icc - 1].dict += ' >>';
    const oi = add(`<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB) /Info (sRGB IEC61966-2.1) /DestOutputProfile ${icc} 0 R >>`);
    let cat = `<< /Type /Catalog /Pages ${pagesId} 0 R /Metadata ${meta} 0 R /OutputIntents [${oi} 0 R] /Lang (de-DE)`;
    if (fsRefs.length) cat += ` /Names << /EmbeddedFiles << /Names [${fsRefs.map(f => `${pdfStr(f.name)} ${f.ref} 0 R`).join(' ')}] >> >> /AF [${fsRefs.map(f => f.ref + ' 0 R').join(' ')}]`;
    const catalog = add(cat + ' >>');
    const info = add(`<< /Title ${pdfStr(title)} /Author ${pdfStr(this.opts.author || 'KuentaPOS')} /Creator (KuentaPOS) /Producer (KuentaPOS PDF) /CreationDate ${pdfStr(pdfDate(now))} /ModDate ${pdfStr(pdfDate(now))} >>`);
    // serialise
    const chunks = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; let pos = chunks[0].length; const xref = [];
    objs.forEach((o, i) => {
      xref.push(pos);
      let b;
      if (typeof o === 'string') b = Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1');
      else b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      chunks.push(b); pos += b.length;
    });
    const id = crypto.randomBytes(16).toString('hex');
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${pos}\n%%EOF\n`;
    chunks.push(Buffer.from(x, 'latin1'));
    return Buffer.concat(chunks);
  }
}

module.exports = { PDFDoc, MM, toCp1252 };
