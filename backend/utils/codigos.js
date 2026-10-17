const crypto = require("crypto");

// Sin 0/O/1/I para que los códigos impresos no se confundan
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Código aleatorio criptográfico; la unicidad la garantiza la PK de keychains
function generarCodigoLlavero(prefijo = "QR-", largo = 8) {
  let codigo = "";
  for (let i = 0; i < largo; i++) {
    codigo += ALFABETO[crypto.randomInt(ALFABETO.length)];
  }
  return prefijo + codigo;
}

module.exports = { generarCodigoLlavero };
