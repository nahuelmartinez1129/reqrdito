// Configuración leída del entorno, validada una sola vez al arrancar.
// Nunca imprime valores: solo nombres de variables faltantes.

const { estadoPrecioPrueba } = require("./precios");

const esProduccion = () => process.env.NODE_ENV === "production";

function lista(valor) {
  return String(valor || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function sinBarraFinal(url) {
  return String(url).replace(/\/+$/, "");
}

const config = {
  get produccion() { return esProduccion(); },

  // Dominio donde vive el frontend (redirecciones y links de emails)
  get frontendUrl() { return sinBarraFinal(process.env.FRONTEND_URL || "https://www.reqrdito.com"); },
  // Dominio público de la API (notificaciones de Mercado Pago, QR de llaveros)
  get apiUrl() { return sinBarraFinal(process.env.API_URL || "https://api.reqrdito.com"); },
  // Notificaciones de Mercado Pago. MP_NOTIFICATION_URL sirve para un túnel HTTPS en
  // pruebas locales; sin HTTPS no se envía (Mercado Pago no puede llegar a localhost).
  get notificationUrl() {
    const url = process.env.MP_NOTIFICATION_URL || `${this.apiUrl}/api/webhook`;
    return /^https:\/\//.test(url) ? url : null;
  },
  // Base de los QR de recuerdos: los ya impresos usan este dominio, no cambiarlo
  get qrRecuerdoBase() { return sinBarraFinal(process.env.QR_RECUERDO_BASE || "https://reqrdito.com"); },

  get corsOrigins() {
    const extra = lista(process.env.CORS_ORIGINS);
    return extra.length ? extra : ["https://reqrdito.com", "https://www.reqrdito.com"];
  },

  // Emails (minúsculas) con acceso a los paneles administrativos
  get adminEmails() { return lista(process.env.ADMIN_EMAILS).map(e => e.toLowerCase()); },

  // Módulo de eventos: deshabilitado salvo EVENTS_ENABLED=true
  get eventsEnabled() { return process.env.EVENTS_ENABLED === "true"; },

  get jwtExpiresIn() { return process.env.JWT_EXPIRES_IN || "30m"; },

  // Fuera de producción los emails se simulan salvo EMAIL_ENABLED=true
  get emailEnabled() {
    if (process.env.EMAIL_ENABLED === "false") return false;
    return esProduccion() || process.env.EMAIL_ENABLED === "true";
  }
};

const OBLIGATORIAS = ["DATABASE_URL", "JWT_SECRET", "GOOGLE_CLIENT_ID", "MP_ACCESS_TOKEN"];
const OBLIGATORIAS_PRODUCCION = ["BREVO_PASS", "ADMIN_EMAILS"];

// Devuelve { errores, avisos }; server.js corta el arranque si hay errores
function validarEntorno() {
  const errores = [];
  const avisos = [];

  for (const nombre of OBLIGATORIAS) {
    if (!process.env[nombre]) errores.push(`Falta ${nombre}`);
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    errores.push("JWT_SECRET debe tener al menos 32 caracteres");
  }

  if (esProduccion()) {
    for (const nombre of OBLIGATORIAS_PRODUCCION) {
      if (!process.env[nombre]) errores.push(`Falta ${nombre} (obligatoria en producción)`);
    }
  } else {
    avisos.push("NODE_ENV no es 'production': CORS acepta localhost y los emails se simulan (EMAIL_ENABLED=true para enviarlos)");
    if (/^APP_USR-/.test(process.env.MP_ACCESS_TOKEN || "")) {
      avisos.push("MP_ACCESS_TOKEN es APP_USR- fuera de producción: solo se crean preferencias si pertenece a una cuenta de prueba de Mercado Pago (vendedor de prueba)");
    }
  }

  // Precio temporal de prueba: se informa siempre que esté configurado (activo o no)
  const prueba = estadoPrecioPrueba();
  if (prueba.activo) {
    avisos.push(`PRECIO DE PRUEBA ACTIVO: Individual ${prueba.monto} ARS hasta ${prueba.hasta.toISOString()}`);
  } else if (prueba.motivo !== "sin_configurar") {
    avisos.push(`PRECIO_PRUEBA_* configurado pero NO aplicado (${prueba.motivo}): se cobra el precio oficial`);
  }

  if (!config.adminEmails.length) {
    avisos.push("ADMIN_EMAILS vacío: los paneles administrativos rechazan a todos");
  }

  return { errores, avisos };
}

module.exports = { config, validarEntorno };
