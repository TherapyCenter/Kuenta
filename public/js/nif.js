'use strict';
// Tax IDs: Spanish DNI (12345678Z), NIE (X1234567L), CIF of companies (B12345674) and special NIF (K/L/M);
// UK VAT registration numbers (GB123456782); French SIREN (9 digits) and SIRET (14 digits);
// Austrian UID (ATU12345678), Swiss UID (CHE-123.456.789), Italian partita IVA and codice fiscale,
// Dutch btw-id (NL123456789B01) and KvK number. Shared by server and browser (UMD).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NIF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';

  // upper case, without spaces, dots, dashes and a leading country code "ES"
  function limpiar(s) {
    let x = String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');
    if (/^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(x)) x = x.slice(2);
    return x;
  }

  function cifControl(cuerpo) {
    let par = 0, impar = 0;
    for (let i = 0; i < 7; i++) {
      const n = Number(cuerpo[i]);
      if (i % 2 === 1) par += n;
      else { const d = n * 2; impar += Math.floor(d / 10) + (d % 10); }
    }
    const c = (10 - ((par + impar) % 10)) % 10;
    return { digito: String(c), letra: 'JABCDEFGHI'[c] };
  }

  // Returns { ok, tipo: 'DNI'|'NIE'|'CIF'|'NIF', nif } or { ok: false, nif, error }
  function validar(s) {
    const nif = limpiar(s);
    if (!nif) return { ok: false, nif, error: 'vacío' };
    let m = nif.match(/^(\d{8})([A-Z])$/);
    if (m) return LETRAS[Number(m[1]) % 23] === m[2] ? { ok: true, tipo: 'DNI', nif } : { ok: false, nif, error: 'letra' };
    m = nif.match(/^([XYZ])(\d{7})([A-Z])$/);
    if (m) {
      const n = Number('XYZ'.indexOf(m[1]) + m[2]);
      return LETRAS[n % 23] === m[3] ? { ok: true, tipo: 'NIE', nif } : { ok: false, nif, error: 'letra' };
    }
    m = nif.match(/^([KLM])(\d{7})([A-Z])$/);
    if (m) return LETRAS[Number(m[2]) % 23] === m[3] ? { ok: true, tipo: 'NIF', nif } : { ok: false, nif, error: 'letra' };
    m = nif.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
    if (m) {
      const c = cifControl(m[2]);
      const soloLetra = 'PQRSNW'.includes(m[1]) || m[2].startsWith('00');
      const soloDigito = 'ABEH'.includes(m[1]);
      const ok = soloLetra ? m[3] === c.letra : soloDigito ? m[3] === c.digito : (m[3] === c.letra || m[3] === c.digito);
      return ok ? { ok: true, tipo: 'CIF', nif } : { ok: false, nif, error: 'control' };
    }
    return { ok: false, nif, error: 'formato' };
  }

  // EU VAT ID of another country (e.g. DE123456789), used as IDOtro in VERI*FACTU
  function extranjero(s) {
    const x = String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');
    const m = x.match(/^([A-Z]{2})([0-9A-Z]{2,15})$/);
    if (!m || m[1] === 'ES') return null;
    return { pais: m[1] === 'EL' ? 'GR' : m[1], id: x };
  }

  // UK VAT registration number: 9 digits (modulus 97 or 97-55 check), 12 digits for branches, GD/HA + 3 digits
  function gbVat(s) {
    const x = String(s || '').toUpperCase().replace(/[\s.\-]/g, '').replace(/^(GB|XI)/, '');
    if (/^(GD|HA)\d{3}$/.test(x)) return { ok: true, vrn: x };
    const m = x.match(/^(\d{9})(\d{3})?$/);
    if (!m) return { ok: false, vrn: x };
    const d = m[1].split('').map(Number);
    const sum = d.slice(0, 7).reduce((a, v, i) => a + v * (8 - i), 0) + Number(m[1].slice(7));
    return { ok: sum % 97 === 0 || (sum + 55) % 97 === 0, vrn: m[1] + (m[2] || '') };
  }

  // French SIREN / SIRET: Luhn check (La Poste establishments: sum of digits divisible by 5)
  function frSiren(s) {
    const x = String(s || '').replace(/[\s.\-]/g, '');
    if (!/^(\d{9}|\d{14})$/.test(x)) return { ok: false, num: x };
    if (x.length === 14 && x.startsWith('356000000')) return { ok: x.split('').reduce((a, c) => a + Number(c), 0) % 5 === 0, num: x };
    let sum = 0;
    for (let i = 0; i < x.length; i++) { let d = Number(x[x.length - 1 - i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return { ok: sum % 10 === 0, num: x };
  }

  // Austrian UID: ATU + 8 digits, the last one is a check digit (BMF algorithm)
  function atUid(s) {
    const x = String(s || '').toUpperCase().replace(/[\s.\-]/g, '');
    const m = /^ATU(\d{8})$/.exec(x);
    if (!m) return { ok: false, uid: x };
    const c = m[1].split('').map(Number);
    const sx = d => Math.floor(d / 5) + (d * 2) % 10;
    const r = sx(c[1]) + sx(c[3]) + sx(c[5]) + c[0] + c[2] + c[4] + c[6];
    return { ok: (10 - (r + 4) % 10) % 10 === c[7], uid: x };
  }

  // Swiss UID: CHE + 9 digits, check digit modulo 11 (weights 5 4 3 2 7 6 5 4); shown as CHE-123.456.789
  function chUid(s) {
    const x = String(s || '').toUpperCase().replace(/(MWST|TVA|IVA|HR)$/g, '').replace(/[\s.\-]/g, '');
    const m = /^CHE(\d{9})$/.exec(x);
    if (!m) return { ok: false, uid: x };
    const d = m[1].split('').map(Number);
    const sum = [5, 4, 3, 2, 7, 6, 5, 4].reduce((a, w, i) => a + w * d[i], 0);
    const p = 11 - (sum % 11);
    const ok = p !== 10 && (p === 11 ? 0 : p) === d[8];
    return { ok, uid: `CHE-${m[1].slice(0, 3)}.${m[1].slice(3, 6)}.${m[1].slice(6)}` };
  }

  // Italian partita IVA: 11 digits, the last one is a Luhn-like check digit (optional prefix IT)
  function itPiva(s) {
    const x = String(s || '').toUpperCase().replace(/[\s.\-]/g, '').replace(/^IT(?=\d{11}$)/, '');
    if (!/^\d{11}$/.test(x) || /^0{11}$/.test(x)) return { ok: false, piva: x };
    let sum = 0;
    for (let i = 0; i < 10; i++) { let d = Number(x[i]); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
    return { ok: (10 - sum % 10) % 10 === Number(x[10]), piva: x };
  }

  // Italian codice fiscale: 16 characters of persons (check letter, also with omocodia) or 11 digits of companies
  const CF_DISPARI = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  function itCf(s) {
    const x = String(s || '').toUpperCase().replace(/[\s\-]/g, '');
    if (/^\d{11}$/.test(x)) return { ok: itPiva(x).ok, cf: x, persona: false };
    if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(x)) return { ok: false, cf: x, persona: true };
    let sum = 0;
    for (let i = 0; i < 15; i++) {
      const c = x[i]; const v = /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
      sum += i % 2 === 0 ? CF_DISPARI[v] : v;
    }
    return { ok: String.fromCharCode(65 + sum % 26) === x[15], cf: x, persona: true };
  }

  // Dutch btw-identificatienummer NL + 9 digits + B + 2 digits: either the eleven test on the 9 digits (older
  // numbers) or ISO 7064 modulo 97 over the whole number (numbers of sole traders since 2020)
  function nlBtw(s) {
    const x = String(s || '').toUpperCase().replace(/[\s.\-]/g, '');
    const m = /^NL(\d{9})B(\d{2})$/.exec(x);
    if (!m) return { ok: false, btw: x };
    const d = m[1].split('').map(Number);
    const elf = d.slice(0, 8).reduce((a, v, i) => a + v * (9 - i), 0) - d[8];
    let r = 0; for (const c of x.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55))) r = (r * 10 + Number(c)) % 97;
    return { ok: elf % 11 === 0 || r === 1, btw: x };
  }
  // KvK number: 8 digits (Kamer van Koophandel, no check digit)
  function nlKvk(s) { const x = String(s || '').replace(/\D/g, ''); return { ok: /^\d{8}$/.test(x), kvk: x }; }

  return { validar, limpiar, extranjero, gbVat, frSiren, atUid, chUid, itPiva, itCf, nlBtw, nlKvk };
});
