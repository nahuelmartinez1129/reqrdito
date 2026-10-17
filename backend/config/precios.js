// Fuente única de verdad de los importes que cobra ReQRdito.
// El frontend los consulta en GET /api/precios; nunca envía un importe propio.
// `pareja` es el valor interno histórico del pack que se muestra como "Dúo".

const MONEDA = "ARS";

const PRECIOS = Object.freeze({
  individual: Object.freeze({ monto: 11990, moneda: MONEDA, nombre: "Individual", titulo: "Recuerdo QR – Individual" }),
  pareja: Object.freeze({ monto: 21990, moneda: MONEDA, nombre: "Dúo", titulo: "Recuerdo QR – Dúo" })
});

// Tarifa anterior. Solo se acepta para preferencias creadas antes de que el
// backend empezara a guardar `monto_esperado` (ver services/pagos.js).
const PRECIOS_ANTERIORES = Object.freeze({
  individual: 6900,
  pareja: 10900
});

function precioDe(pack) {
  return Object.prototype.hasOwnProperty.call(PRECIOS, pack) ? PRECIOS[pack] : null;
}

module.exports = { MONEDA, PRECIOS, PRECIOS_ANTERIORES, precioDe };
