'use strict';
// Tests: Kuenta Pro license (signature check, expiry, installing) and license tool
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kuenta-lizenz-'));
process.env.KUENTA_DATA = path.join(tmp, 'daten');
process.env.KUENTA_LANG = 'de';   // the tool output is checked in German

const LIZENZ = require('../server/lizenz');
const ECHT = fs.readFileSync(path.join(__dirname, '..', 'server', 'lizenz.js'), 'utf8').match(/let OEFFENTLICH = '([^']+)'/)[1];

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const X = publicKey.export({ format: 'jwk' }).x;
function signiere(daten, key = privateKey) { const kopf = 'KUENTA1.' + Buffer.from(JSON.stringify(daten)).toString('base64url'); return kopf + '.' + crypto.sign(null, Buffer.from(kopf), key).toString('base64url'); }
const heute = new Date().toISOString().slice(0, 10);

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('echter Prüfschlüssel ist eingetragen', () => {
  assert.match(ECHT, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotThrow(() => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: ECHT }, format: 'jwk' }));
});

test('Signatur: gültig, verändert, fremder Schlüssel', () => {
  const k = signiere({ v: 1, id: 'a', kunde: 'Werkstatt', funktionen: ['sms'], ausgestellt: heute, bis: null });
  assert.strictEqual(LIZENZ.pruefen(k, X).kunde, 'Werkstatt');
  assert.strictEqual(LIZENZ.pruefen(k.replace(/(.{40})/g, '$1\n'), X).kunde, 'Werkstatt'); // line breaks from copying
  const [p, d, s] = k.split('.');
  const anders = Buffer.from(JSON.stringify({ v: 1, id: 'a', kunde: 'Werkstatt', funktionen: ['pro'], ausgestellt: heute, bis: null })).toString('base64url');
  assert.throws(() => LIZENZ.pruefen([p, anders, s].join('.'), X), /Signatur/);
  const fremd = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.throws(() => LIZENZ.pruefen(signiere({ funktionen: ['pro'] }, fremd), X), /Signatur/);
  assert.throws(() => LIZENZ.pruefen('irgendwas', X), /kein Kuenta-Lizenzschlüssel/);
  assert.throws(() => LIZENZ.pruefen(k, ECHT), /Signatur/); // test key does not match the real one
  assert.ok(d);
});

test('Einspielen, Funktionen, Ablauf, Entfernen', () => {
  LIZENZ._pruefschluessel(X);
  assert.strictEqual(LIZENZ.hat('sms'), false);
  assert.deepStrictEqual(LIZENZ.status().funktionen, []);
  assert.throws(() => LIZENZ.brauche('sms'), e => e.status === 402 && /Kuenta Pro/.test(e.message));

  assert.throws(() => LIZENZ.einspielen(signiere({ v: 1, id: 'b', kunde: 'W', funktionen: ['pro'], ausgestellt: '2020-01-01', bis: '2021-01-01' })), /abgelaufen/);
  assert.throws(() => LIZENZ.einspielen('KUENTA1.xx.yy'), /ungültig|beschädigt/);

  const st = LIZENZ.einspielen(signiere({ v: 1, id: 'c', kunde: 'Werkstatt Muster', funktionen: ['sms'], ausgestellt: heute, bis: '2999-12-31' }));
  assert.deepStrictEqual(st.funktionen, ['sms']);
  assert.strictEqual(st.kunde, 'Werkstatt Muster');
  assert.ok(fs.existsSync(path.join(process.env.KUENTA_DATA, 'lizenz.key')));
  assert.ok(LIZENZ.hat('sms'));
  assert.ok(!LIZENZ.hat('etwasneues'));

  // "pro" also unlocks future features
  LIZENZ.einspielen(signiere({ v: 1, id: 'd', kunde: 'W', funktionen: ['pro'], ausgestellt: heute, bis: null }));
  assert.ok(LIZENZ.hat('etwasneues'));

  // expired file on disk (e.g. a yearly license has ended)
  fs.writeFileSync(path.join(process.env.KUENTA_DATA, 'lizenz.key'), signiere({ v: 1, id: 'e', kunde: 'W', funktionen: ['pro'], ausgestellt: '2020-01-01', bis: '2021-01-01' }));
  assert.ok(!LIZENZ.hat('sms'));
  assert.ok(LIZENZ.status().abgelaufen);
  assert.throws(() => LIZENZ.brauche('sms'), /abgelaufen/);

  LIZENZ.entfernen();
  assert.strictEqual(LIZENZ.status().vorhanden, false);
});

test('Lizenzwerkzeug: Schlüsselpaar, Ausstellen, Register', () => {
  const home = path.join(tmp, 'herausgeber');
  const tool = path.join(__dirname, '..', 'tools', 'lizenz', 'lizenz-werkzeug.js');
  const env = { ...process.env, KUENTA_LIZENZ_HOME: home };
  const out1 = execFileSync(process.execPath, [tool, 'schluessel'], { env, encoding: 'utf8' });
  const x = out1.trim().split('\n').pop().trim();
  assert.match(x, /^[A-Za-z0-9_-]{43}$/);
  const out2 = execFileSync(process.execPath, [tool, 'ausstellen', '--kunde', 'Kfz Meier; Söhne', '--funktionen', 'sms', '--bis', '2999-01-31', '--zahlung', 'BTC 0.001'], { env, encoding: 'utf8' });
  const key = out2.split('\n').find(l => l.startsWith('KUENTA1.'));
  const d = LIZENZ.pruefen(key, x);
  assert.deepStrictEqual(d.funktionen, ['sms']);
  assert.strictEqual(d.kunde, 'Kfz Meier; Söhne');
  assert.strictEqual(d.bis, '2999-01-31');
  const reg = fs.readFileSync(path.join(home, 'ausgestellt.csv'), 'utf8');
  assert.match(reg, /"Kfz Meier; Söhne"/);
  assert.match(reg, /BTC 0\.001/);
  // a second call does not overwrite the private key
  assert.match(execFileSync(process.execPath, [tool, 'schluessel'], { env, encoding: 'utf8' }), /Es gibt schon/);
});
