'use strict';
// Up to version 1.8.2 the program was called "Kuenta" and read KUENTA_* environment variables.
// Take them over as KUENTAPOS_* so existing setups (e.g. KUENTA_DATA) keep working.
for (const [k, v] of Object.entries(process.env)) {
  if (k.startsWith('KUENTA_')) {
    const neu = 'KUENTAPOS_' + k.slice(7);
    if (process.env[neu] === undefined) process.env[neu] = v;
  }
}
