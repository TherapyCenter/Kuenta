'use strict';
// The billing software ("sistema informático de facturación") as it is reported in every VERI*FACTU record.
// The producer of the software is the publisher of Kuenta. Fill in the producer's tax ID before going live:
// a Spanish NIF in "nif", or for a producer without a Spanish NIF the EU VAT ID in "idOtro"
// (IDType "02" = NIF-IVA), e.g. { pais: 'DE', tipo: '02', id: 'DE123456789' }.
// Environment variables override the values (KUENTA_SIF_NOMBRE, KUENTA_SIF_NIF, KUENTA_SIF_IDOTRO=DE:02:DE123456789).
const pkg = require('../../package.json');

function productor() {
  const env = process.env;
  let idOtro = null;
  if (env.KUENTA_SIF_IDOTRO) { const [pais, tipo, id] = env.KUENTA_SIF_IDOTRO.split(':'); idOtro = { pais, tipo, id }; }
  return {
    nombreRazon: env.KUENTA_SIF_NOMBRE || 'Doc',
    nif: env.KUENTA_SIF_NIF || '',
    idOtro: idOtro || null,
    nombreSistema: 'Kuenta',
    id: 'KU', // IdSistemaInformatico, 2 characters
    version: pkg.version,
  };
}

module.exports = { productor };
