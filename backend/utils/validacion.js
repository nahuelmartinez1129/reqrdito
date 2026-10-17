// Validaciones compartidas por las rutas

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Códigos de llavero: "QR-XXXXXXXX" (panel), "KEYXXXXXX" (script) o los históricos
const CODIGO_LLAVERO_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function codigoLlaveroValido(value) {
  return typeof value === "string" && CODIGO_LLAVERO_RE.test(value);
}

function normalizarEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

// Entero dentro de un rango; devuelve null si no es válido
function enteroEnRango(value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

const PACKS = ["individual", "pareja"];

module.exports = { isUuid, codigoLlaveroValido, normalizarEmail, enteroEnRango, PACKS };
