// Decide si la credencial de Mercado Pago puede crear preferencias en este entorno.
//
// - En producción: siempre.
// - Fuera de producción:
//   · TEST-...  → credencial de prueba de la cuenta real: permitida.
//   · APP_USR-… → solo si pertenece a una CUENTA DE PRUEBA de Mercado Pago (vendedor de
//     prueba: GET /users/me trae la etiqueta "test_user"). Una credencial de la cuenta real
//     crearía cobros reales desde una PC local, así que se bloquea.
//     MP_ALLOW_PRODUCTION_TOKEN=true saltea el control (decisión explícita del operador).
// Ante cualquier duda (sin red, respuesta inesperada) se bloquea.
const crypto = require("crypto");
const { config } = require("../config/env");

const cache = new Map(); // hash del token -> Promise<boolean>

const verificador = {
  // Reemplazable en tests. Devuelve true solo si la cuenta es de prueba.
  async esCuentaDePrueba(token) {
    const res = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return false;
    const usuario = await res.json();
    return Array.isArray(usuario.tags) && usuario.tags.includes("test_user");
  }
};

async function credencialPermitida() {
  const token = process.env.MP_ACCESS_TOKEN || "";
  if (config.produccion) return true;
  if (/^TEST-/.test(token)) return true;
  if (!/^APP_USR-/.test(token)) return false;
  if (process.env.MP_ALLOW_PRODUCTION_TOKEN === "true") return true;

  const clave = crypto.createHash("sha256").update(token).digest("hex");
  if (!cache.has(clave)) {
    cache.set(clave, verificador.esCuentaDePrueba(token).catch(() => false));
  }
  const ok = await cache.get(clave);
  if (!ok) cache.delete(clave); // reintenta la próxima vez (p. ej. si faltó la red)
  return ok;
}

module.exports = { credencialPermitida, verificador };
