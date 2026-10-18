// API de conversiones de Meta: envía desde el servidor los mismos eventos que el pixel,
// con el mismo event_id para que Meta cuente uno solo:
// - InitiateCheckout (checkout_<recuerdoId>) al crear la preferencia de pago (pago.html)
// - Purchase (purchase_<recuerdoId>) cuando el pago queda aprobado (pago-exito.html)
//
// Reglas:
// - Nunca lanza error: un fallo de Meta no debe hacer que Mercado Pago reintente
//   el webhook ni frenar la activación del recuerdo. Solo se registra.
// - Los datos del navegador (cookies _fbp/_fbc, IP, user agent) se guardan en la
//   metadata de la preferencia al crearla, porque el webhook llega desde Mercado Pago.
// - Los emails y el id de usuario se envían con hash SHA-256, como pide Meta.
// - Sin META_PIXEL_ID o META_CAPI_TOKEN no se envía nada (entorno local, tests).

const crypto = require("crypto");

const GRAPH_URL = "https://graph.facebook.com/v21.0";
// Meta rechaza eventos con más de 7 días de antigüedad
const ANTIGUEDAD_MAX_S = 7 * 24 * 3600;

function hash(valor) {
  const limpio = String(valor || "").trim().toLowerCase();
  return limpio ? crypto.createHash("sha256").update(limpio).digest("hex") : null;
}

function texto(valor, max) {
  return typeof valor === "string" && valor ? valor.slice(0, max) : undefined;
}

// Lo que se guarda en la metadata de la preferencia (Mercado Pago la devuelve en el pago)
function datosNavegador(req) {
  const body = req.body || {};
  return {
    meta_fbp: texto(body.fbp, 200),
    meta_fbc: texto(body.fbc, 500),
    // nginx pone X-Real-IP con la IP del visitante; en local no hay proxy
    meta_ip: texto(req.get("x-real-ip") || req.ip, 64),
    meta_ua: texto(req.get("user-agent"), 500)
  };
}

// user_data de Meta: emails e id con hash; `nav` tiene las claves meta_* de datosNavegador
function datosUsuario(emails, userId, nav) {
  const em = [...new Set(emails.map(hash).filter(Boolean))];
  const userData = {
    em: em.length ? em : undefined,
    external_id: userId ? [hash(userId)] : undefined,
    client_ip_address: texto(nav.meta_ip, 64),
    client_user_agent: texto(nav.meta_ua, 500),
    fbp: texto(nav.meta_fbp, 200),
    fbc: texto(nav.meta_fbc, 500)
  };
  return JSON.parse(JSON.stringify(userData));
}

/**
 * Evento InitiateCheckout: la preferencia de Mercado Pago quedó creada.
 * @param {object} p
 * @param {object} p.recuerdo - id y pack
 * @param {object} p.navegador - resultado de datosNavegador(req)
 * @param {string} [p.email] - email de la cuenta de quien paga
 * @param {string} [p.userId]
 * @param {number} p.monto
 * @param {string} p.moneda
 * @param {string} p.sitio - URL del frontend
 */
function eventoInicioPago({ recuerdo, navegador, email, userId, monto, moneda, sitio, ahora = Date.now() }) {
  return {
    event_name: "InitiateCheckout",
    event_time: Math.floor(ahora / 1000),
    event_id: `checkout_${recuerdo.id}`,
    action_source: "website",
    event_source_url: `${sitio}/pago.html`,
    user_data: datosUsuario([email], userId, navegador || {}),
    custom_data: {
      value: Number(monto),
      currency: moneda,
      content_ids: [recuerdo.pack || "individual"],
      content_type: "product",
      num_items: 1
    }
  };
}

/**
 * Evento Purchase para la API de conversiones.
 * @param {object} p
 * @param {object} p.recuerdo - id y pack
 * @param {object} p.pago - respuesta de Payment.get (metadata, payer, date_approved)
 * @param {string} [p.emailDueno] - email de la cuenta de Google del dueño
 * @param {string} [p.userId]
 * @param {number} p.monto
 * @param {string} p.moneda
 * @param {string} p.sitio - URL del frontend
 */
function eventoCompra({ recuerdo, pago, emailDueno, userId, monto, moneda, sitio, ahora = Date.now() }) {
  const meta = pago.metadata || {};
  const ahoraS = Math.floor(ahora / 1000);
  const aprobado = Math.floor(Date.parse(pago.date_approved) / 1000);
  const eventTime = Number.isFinite(aprobado) && aprobado <= ahoraS && ahoraS - aprobado < ANTIGUEDAD_MAX_S
    ? aprobado
    : ahoraS;

  return {
    event_name: "Purchase",
    event_time: eventTime,
    event_id: `purchase_${recuerdo.id}`,
    action_source: "website",
    event_source_url: `${sitio}/pago-exito.html`,
    user_data: datosUsuario([emailDueno, pago.payer?.email], userId, meta),
    custom_data: {
      value: Number(monto),
      currency: moneda,
      content_ids: [recuerdo.pack || "individual"],
      content_type: "product",
      num_items: 1
    }
  };
}

/**
 * Envía el evento a Meta. Devuelve "enviado", "deshabilitado" o "error"; nunca lanza.
 */
async function enviarEvento(evento, { env = process.env, fetchFn = fetch } = {}) {
  const pixelId = env.META_PIXEL_ID;
  const token = env.META_CAPI_TOKEN;
  if (!pixelId || !token) return "deshabilitado";

  const cuerpo = { data: [evento] };
  if (env.META_TEST_EVENT_CODE) cuerpo.test_event_code = env.META_TEST_EVENT_CODE;

  try {
    const res = await fetchFn(`${GRAPH_URL}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      // El mensaje de Meta no incluye el token; se recorta por las dudas
      const detalle = (await res.text().catch(() => "")).slice(0, 300);
      console.error(`📊 Meta CAPI ${evento.event_name} ${evento.event_id}: HTTP ${res.status} ${detalle}`);
      return "error";
    }
    console.log(`📊 Meta CAPI ${evento.event_name} ${evento.event_id}: enviado`);
    return "enviado";
  } catch (err) {
    console.error(`📊 Meta CAPI ${evento.event_name} ${evento.event_id}: ${err.message}`);
    return "error";
  }
}

module.exports = { datosNavegador, eventoInicioPago, eventoCompra, enviarEvento, hash };
