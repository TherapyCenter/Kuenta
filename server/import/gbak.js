'use strict';
// Reader for Firebird gbak backup files (.fbk / .bak as written by KFZ-Faktura).
// Supports backup format versions 5-10 (Firebird 1.x - 3.x), transportable (XDR)
// and native layout, with or without gbak RLE compression.
// Format reference: Firebird open source, src/burp/{burp.h,backup.epp,canonical.cpp}.

const REC = {
  burp: 0, database: 1, global_field: 2, relation: 3, field: 4, index: 5, data: 6, blob: 7,
  relation_data: 8, relation_end: 9, end: 10, view: 11, security_class: 12, trigger: 13,
  physical_db: 14, function: 15, function_arg: 16, function_end: 17, gen_id: 18, system_type: 19,
  filter: 20, trigger_message: 21, user_privilege: 22, array: 23, field_dimensions: 24, files: 25,
  generator: 26, procedure: 27, procedure_prm: 28, procedure_end: 29, exception: 30,
  rel_constraint: 31, ref_constraint: 32, chk_constraint: 33, charset: 34, collation: 35,
  sql_roles: 36, mapping: 37, package: 38, db_crypt: 39,
};

// Attributes whose value is "length (4 byte) + length bytes" (blr/source blobs), per record type.
const BLOB_ATTRS = {
  [REC.database]: [6, 10],
  [REC.physical_db]: [6, 10],
  [REC.global_field]: [6, 15, 16, 17, 18, 19, 20, 21, 35, 36, 37, 39, 40],
  [REC.field]: [6, 15, 16, 17, 18, 19, 20, 21, 35, 36, 37, 39, 40],
  [REC.relation]: [2, 3, 9, 11, 13, 14, 15],
  [REC.index]: [6, 9, 10, 11],
  [REC.security_class]: [12, 13, 19],
  [REC.trigger]: [2, 3, 7, 10, 11, 14],
  [REC.function]: [2, 9],
  [REC.system_type]: [4, 7, 12, 13],
  [REC.filter]: [4, 7, 12, 13],
  [REC.generator]: [4],
  [REC.procedure]: [4, 5, 6, 7, 8, 13],
  [REC.procedure_prm]: [5, 6, 7, 8],
  [REC.exception]: [3, 4],
  [REC.charset]: [7],
  [REC.collation]: [6, 9],
  [REC.sql_roles]: [3],
  [REC.package]: [3, 4, 5, 6],
};
// Attributes with a 2-byte length (put_message long form)
const LONG_TEXT_ATTRS = { [REC.exception]: [5] };

// blr data types
const BLR = { text: 14, text2: 15, short: 7, long: 8, quad: 9, float: 10, double: 27, d_float: 11,
  timestamp: 35, varying: 37, varying2: 38, blob: 261, cstring: 40, cstring2: 41, blob_id: 45,
  sql_date: 12, sql_time: 13, int64: 16, bool: 23, dec64: 24, dec128: 25, int128: 26,
  sql_time_tz: 28, timestamp_tz: 29 };

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  eof() { return this.p >= this.b.length; }
  u8() { if (this.p >= this.b.length) throw new Error('Unerwartetes Dateiende im Backup'); return this.b[this.p++]; }
  bytes(n) { if (this.p + n > this.b.length) throw new Error('Unerwartetes Dateiende im Backup'); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  i32le() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
}

function vaxInt(bytes) { // little-endian signed
  let v = 0;
  for (let i = bytes.length - 1; i >= 0; i--) v = v * 256 + bytes[i];
  if (bytes.length && (bytes[bytes.length - 1] & 0x80)) v -= Math.pow(256, bytes.length);
  return v;
}

const latin = new TextDecoder('windows-1252');
const utf8 = new TextDecoder('utf-8');

// Firebird date: days since 1858-11-17
const FB_EPOCH = Date.UTC(1858, 10, 17);
function fbDate(days) {
  const d = new Date(FB_EPOCH + days * 86400000);
  return d.toISOString().slice(0, 10);
}
function fbTime(t) { // 1/10000 sec
  const ms = Math.floor(t / 10);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function alignUp(v, a) { return a ? Math.ceil(v / a) * a : v; }

class GbakParser {
  constructor(buf, opts = {}) {
    this.r = new Reader(buf);
    this.opts = opts;
    this.header = {};
    this.relations = new Map(); // name -> {name, fields:[], dataOrder}
    this.generators = {};
    this.charsetDecoder = opts.utf8 ? utf8 : latin;
  }

  // Read attributes of a record until att_end. handler(att, kind, value)
  readAttrs(recType, onAttr) {
    const r = this.r;
    const blobs = BLOB_ATTRS[recType] || [];
    const longText = LONG_TEXT_ATTRS[recType] || [];
    for (;;) {
      const att = r.u8();
      if (att === 0) return;
      if (longText.includes(att)) {
        const len = r.u8() | (r.u8() << 8);
        onAttr(att, r.bytes(len));
        continue;
      }
      const len = r.u8();
      const val = r.bytes(len);
      if (blobs.includes(att) && len === 4) {
        const n = val.readUInt32LE(0);
        r.bytes(n); // skip blob content
        continue;
      }
      onAttr(att, val);
    }
  }

  parse(onTable, onRow) {
    const r = this.r;
    let rec = r.u8();
    if (rec !== REC.burp) throw new Error('Keine gültige Firebird-Sicherungsdatei (gbak)');
    this.readAttrs(REC.burp, (att, v) => {
      switch (att) {
        case 1: this.header.date = latin.decode(v); break;
        case 2: this.header.format = vaxInt(v); break;
        case 4: this.header.compress = vaxInt(v); break;
        case 5: this.header.transportable = vaxInt(v); break;
        case 6: this.header.blksize = vaxInt(v); break;
        case 7: this.header.file = latin.decode(v); break;
      }
    });
    const fmt = this.header.format || 0;
    if (fmt > 10) throw new Error(`Backup-Format ${fmt} wird nicht unterstützt (Firebird 4+)`);

    let curRelation = null; // during metadata (rec_relation)
    let dataRelation = null; // during rec_relation_data
    while (!r.eof()) {
      rec = r.u8();
      switch (rec) {
        case REC.end: return this;
        case REC.relation: {
          const rel = { name: '', fields: [], flags: 0, view: false, external: false, system: 0 };
          this.readAttrs(REC.relation, (att, v) => {
            if (att === 1) rel.name = latin.decode(v).trim();
            else if (att === 7) rel.system = vaxInt(v);
            else if (att === 16) rel.flags = vaxInt(v);
            else if (att === 17) rel.external = true;
          });
          curRelation = rel;
          this.relations.set(rel.name, rel);
          break;
        }
        case REC.field: {
          const f = { name: '', type: 0, length: 0, scale: 0, subType: 0, number: 0, computed: false, charset: null, dims: 0, nullFlag: 0, position: 0 };
          this.readAttrs(REC.field, (att, v) => {
            switch (att) {
              case 1: f.name = latin.decode(v).trim(); break;
              case 2: f.source = latin.decode(v).trim(); break;
              case 8: f.type = vaxInt(v); break;
              case 9: f.subType = vaxInt(v); break;
              case 10: f.length = vaxInt(v); break;
              case 11: f.scale = vaxInt(v); break;
              case 13: f.position = vaxInt(v); break;
              case 22: f.number = vaxInt(v); break;
              case 23: f.computed = vaxInt(v) !== 0; break;
              case 29: f.dims = vaxInt(v); break;
              case 38: f.nullFlag = vaxInt(v); break;
              case 42: f.charset = vaxInt(v); break;
              case 44: f.precision = vaxInt(v); break;
            }
          });
          if (curRelation) curRelation.fields.push(f);
          break;
        }
        case REC.view:
          if (curRelation) curRelation.view = true;
          this.readAttrs(REC.view, () => {});
          break;
        case REC.relation_end:
          if (dataRelation) {
            if (onTable && dataRelation._started) onTable(dataRelation, 'end');
            dataRelation = null;
          } else curRelation = null;
          break;
        case REC.relation_data: {
          let name = '';
          this.readAttrs(REC.relation_data, (att, v) => { if (att === 1) name = latin.decode(v).trim(); });
          dataRelation = this.relations.get(name);
          if (!dataRelation) throw new Error(`Tabelle ${name} im Backup nicht beschrieben`);
          this.prepareLayout(dataRelation);
          break;
        }
        case REC.index:
          this.readAttrs(REC.index, () => {});
          break;
        case REC.data: {
          if (!dataRelation) throw new Error('Datensatz ohne Tabelle');
          if (!dataRelation._started) { dataRelation._started = true; if (onTable) onTable(dataRelation, 'start'); }
          const row = this.readDataRecord(dataRelation);
          // blobs follow
          for (;;) {
            const save = r.p;
            const next = r.u8();
            if (next === REC.blob) this.readBlob(dataRelation, row);
            else if (next === REC.array) throw new Error('Array-Felder werden nicht unterstützt');
            else { r.p = save; break; }
          }
          if (onRow) onRow(dataRelation, row);
          break;
        }
        case REC.generator: {
          let name = '', value = 0;
          this.readAttrs(REC.generator, (att, v) => {
            if (att === 1) name = latin.decode(v).trim();
            else if (att === 2) value = vaxInt(v);
            else if (att === 3) value = Number(v.readBigInt64LE(0));
          });
          this.generators[name] = value;
          break;
        }
        case REC.procedure: case REC.function:
          this.readAttrs(rec, () => {});
          break;
        case REC.procedure_end: case REC.function_end:
          break;
        default:
          if (rec > REC.db_crypt) throw new Error(`Unbekannter Datensatztyp ${rec} an Position ${r.p - 1}`);
          this.readAttrs(rec, () => {});
      }
    }
    return this;
  }

  prepareLayout(rel) {
    if (rel._layout) return;
    const fields = rel.fields.filter(f => !f.computed);
    rel._layout = fields;
    rel.columns = fields.map(f => ({ name: f.name, type: f.type, length: f.length, scale: f.scale, subType: f.subType, charset: f.charset, number: f.number, notNull: !!f.nullFlag }));
    if (!this.header.transportable) {
      // native layout offsets (x86): alignments
      let off = 0;
      for (const f of fields) {
        let len = f.length, al = 4;
        switch (f.type) {
          case BLR.text: al = 1; break;
          case BLR.varying: al = 2; len += 2; break;
          case BLR.short: al = 2; break;
          case BLR.long: case BLR.sql_date: case BLR.sql_time: case BLR.float: al = 4; break;
          case BLR.double: case BLR.int64: al = 8; break;
          case BLR.timestamp: case BLR.quad: case BLR.blob: al = 4; len = 8; break;
          case BLR.bool: al = 1; len = 1; break;
        }
        if (f.dims) { len = 8; al = 4; }
        off = alignUp(off, al);
        f._off = off; off += len;
      }
      for (const f of fields) { off = alignUp(off, 2); f._nullOff = off; off += 2; }
    }
  }

  readDataRecord(rel) {
    const r = this.r;
    if (r.u8() !== 1) throw new Error('Datensatzlänge erwartet');
    const lenLen = r.u8(); let len = vaxInt(r.bytes(lenLen));
    let att = r.u8();
    if (att === 17) { const l = r.u8(); len = vaxInt(r.bytes(l)); att = r.u8(); }
    if (att !== 2) throw new Error('Datenattribut erwartet');
    let buf;
    if (this.header.compress) {
      buf = Buffer.alloc(len);
      let p = 0;
      while (p < len) {
        let c = r.u8(); if (c > 127) c -= 256;
        if (c > 0) { const n = Math.min(c, len - p); r.bytes(n).copy(buf, p); p += n; if (n < c) r.bytes(c - n); }
        else if (c < 0) { const v = r.u8(); const n = Math.min(-c, len - p); buf.fill(v, p, p + n); p += n; }
      }
    } else buf = r.bytes(len);
    return this.header.transportable ? this.decodeXdr(rel, buf) : this.decodeNative(rel, buf);
  }

  decodeText(bytes, f) {
    if (f.charset === 1) return null; // OCTETS -> handled by caller
    return this.charsetDecoder.decode(bytes);
  }

  decodeXdr(rel, buf) {
    let p = 0;
    const row = {};
    const fields = rel._layout;
    const be32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
    for (const f of fields) {
      if (f.dims) { p += 8; row[f.name] = null; continue; }
      switch (f.type) {
        case BLR.text: case BLR.text2: {
          const s = buf.subarray(p, p + f.length); p += alignUp(f.length, 4);
          row[f.name] = f.charset === 1 ? Buffer.from(s) : this.decodeText(s, f).replace(/ +$/, '');
          break;
        }
        case BLR.varying: case BLR.varying2: {
          const l = be32() & 0xffff;
          const n = Math.min(l, f.length);
          const s = buf.subarray(p, p + n); p += alignUp(n, 4);
          row[f.name] = f.charset === 1 ? Buffer.from(s) : this.decodeText(s, f);
          break;
        }
        case BLR.short: { const v = be32(); row[f.name] = scaleNum((v << 16) >> 16, f.scale); break; }
        case BLR.long: row[f.name] = scaleNum(be32(), f.scale); break;
        case BLR.sql_date: row[f.name] = fbDate(be32()); break;
        case BLR.sql_time: row[f.name] = fbTime(be32() >>> 0); break;
        case BLR.float: row[f.name] = round7(buf.readFloatBE(p)); p += 4; break;
        case BLR.double: case BLR.d_float: row[f.name] = buf.readDoubleBE(p); p += 8; break;
        case BLR.int64: { const v = buf.readBigInt64BE(p); p += 8; row[f.name] = scaleBig(v, f.scale); break; }
        case BLR.timestamp: { const d = be32(), t = be32() >>> 0; row[f.name] = fbDate(d) + ' ' + fbTime(t); break; }
        case BLR.quad: case BLR.blob: case BLR.blob_id: p += 8; row[f.name] = null; break; // filled by blob records
        case BLR.bool: { const v = be32(); row[f.name] = v ? 1 : 0; break; }
        default: throw new Error(`Datentyp ${f.type} (${rel.name}.${f.name}) nicht unterstützt`);
      }
    }
    for (const f of fields) {
      const nul = buf.readInt32BE(p); p += 4;
      if (nul) row[f.name] = null;
    }
    return row;
  }

  decodeNative(rel, buf) {
    const row = {};
    for (const f of rel._layout) {
      const o = f._off;
      if (f.dims) { row[f.name] = null; continue; }
      switch (f.type) {
        case BLR.text: { const s = buf.subarray(o, o + f.length); row[f.name] = f.charset === 1 ? Buffer.from(s) : this.decodeText(s, f).replace(/ +$/, ''); break; }
        case BLR.varying: { const l = buf.readUInt16LE(o); const s = buf.subarray(o + 2, o + 2 + Math.min(l, f.length)); row[f.name] = f.charset === 1 ? Buffer.from(s) : this.decodeText(s, f); break; }
        case BLR.short: row[f.name] = scaleNum(buf.readInt16LE(o), f.scale); break;
        case BLR.long: row[f.name] = scaleNum(buf.readInt32LE(o), f.scale); break;
        case BLR.sql_date: row[f.name] = fbDate(buf.readInt32LE(o)); break;
        case BLR.sql_time: row[f.name] = fbTime(buf.readUInt32LE(o)); break;
        case BLR.float: row[f.name] = round7(buf.readFloatLE(o)); break;
        case BLR.double: row[f.name] = buf.readDoubleLE(o); break;
        case BLR.int64: row[f.name] = scaleBig(buf.readBigInt64LE(o), f.scale); break;
        case BLR.timestamp: row[f.name] = fbDate(buf.readInt32LE(o)) + ' ' + fbTime(buf.readUInt32LE(o + 4)); break;
        case BLR.quad: case BLR.blob: row[f.name] = null; break;
        case BLR.bool: row[f.name] = buf[o] ? 1 : 0; break;
        default: throw new Error(`Datentyp ${f.type} nicht unterstützt`);
      }
    }
    for (const f of rel._layout) if (buf.readInt16LE(f._nullOff)) row[f.name] = null;
    return row;
  }

  readBlob(rel, row) {
    const r = this.r;
    let fieldNo = -1, segments = 0;
    for (;;) {
      const att = r.u8();
      if (att === 7) break; // att_blob_data
      const len = r.u8(); const v = r.bytes(len);
      if (att === 3) fieldNo = vaxInt(v);
      else if (att === 5) segments = vaxInt(v);
    }
    const parts = [];
    for (let i = 0; i < segments; i++) {
      const l = r.u8() | (r.u8() << 8);
      parts.push(r.bytes(l));
    }
    const f = rel._layout.find(x => x.number === fieldNo);
    if (!f) return;
    const data = Buffer.concat(parts);
    row[f.name] = f.subType === 1 ? this.charsetDecoder.decode(data) : Buffer.from(data);
  }
}

function scaleNum(v, scale) {
  if (!scale) return v;
  return Number((v * Math.pow(10, scale)).toFixed(-scale));
}
function scaleBig(v, scale) {
  if (!scale) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v.toString();
  }
  const neg = v < 0n; let a = neg ? -v : v;
  const s = a.toString().padStart(-scale + 1, '0');
  const str = (neg ? '-' : '') + s.slice(0, s.length + scale) + '.' + s.slice(s.length + scale);
  return Number(str);
}
function round7(x) { return Number(x.toPrecision(7)); }

function parseGbak(buf, onTable, onRow, opts) {
  const p = new GbakParser(buf, opts);
  p.parse(onTable, onRow);
  return p;
}

module.exports = { parseGbak, GbakParser, BLR };
