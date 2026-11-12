'use strict';
require('../env'); // accept old KUENTA_* variables
// The billing software ("sistema informático de facturación") as it is reported in every VERI*FACTU record.
// The producer of the software is the publisher of KuentaPOS. Fill in the producer's tax ID before going live:
// a Spanish NIF in "nif", or for a producer without a Spanish NIF the EU VAT ID in "idOtro"
// (IDType "02" = NIF-IVA), e.g. { pais: 'DE', tipo: '02', id: 'DE123456789' }.
// Environment variables override the values (KUENTAPOS_SIF_NOMBRE, KUENTAPOS_SIF_NIF, KUENTAPOS_SIF_IDOTRO=DE:02:DE123456789).
const pkg = require('../../package.json');

function productor() {
  const env = process.env;
  let idOtro = null;
  if (env.KUENTAPOS_SIF_IDOTRO) { const [pais, tipo, id] = env.KUENTAPOS_SIF_IDOTRO.split(':'); idOtro = { pais, tipo, id }; }
  return {
    nombreRazon: env.KUENTAPOS_SIF_NOMBRE || 'Doc',
    nif: env.KUENTAPOS_SIF_NIF || '',
    idOtro: idOtro || null,
    nombreSistema: 'KuentaPOS',
    id: 'KU', // IdSistemaInformatico, 2 characters
    version: pkg.version,
  };
}

module.exports = { productor };
