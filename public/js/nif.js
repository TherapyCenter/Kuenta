'use strict';
// Tax IDs: Spanish DNI (12345678Z), NIE (X1234567L), CIF of companies (B12345674) and special NIF (K/L/M);
// UK VAT registration numbers (GB123456782). Shared by server and browser (UMD).
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

  return { validar, limpiar, extranjero, gbVat };
});
