const express = require("express");
const { Preference } = require("mercadopago");
const client = require("../config/mercadopago");
const prisma = require("../db/prisma");
const auth = require("../middleware/auth");
const requireAuth = require("../middleware/requireAuth");
const { config } = require("../config/env");
const { PRECIOS, precioACobrar } = require("../config/precios");
const { PREFIJO_REFERENCIA } = require("../services/pagos");
const { isUuid } = require("../utils/validacion");
const { credencialPermitida } = require("../services/mpCredencial");

const router = express.Router();

/* =========================
   Cuerpo de la preferencia de Checkout Pro
   Pago como invitado: Checkout Pro deja pagar con tarjeta de crédito o débito sin
   cuenta de Mercado Pago mientras la preferencia NO tenga purpose "wallet_purchase"
   (eso exige iniciar sesión) y no excluya los tipos credit_card / debit_card.
   Los datos de la tarjeta se cargan en Mercado Pago: nunca pasan por este servidor.
========================= */
function cuerpoPreferencia(recuerdo, pack, precio) {
  return {
    items: [
      {
        id: `pack-${pack}`,
        title: precio.titulo,
        quantity: 1,
        unit_price: precio.monto,
        currency_id: precio.moneda,
      },
    ],

    metadata: {
      recuerdo_id: recuerdo.id,
      pack: pack
    },

    back_urls: {
      success: `${config.frontendUrl}/pago-exito.html`,
      failure: `${config.frontendUrl}/error.html`,
      pending: `${config.frontendUrl}/pago-pendiente.html`,
    },

    external_reference: `${PREFIJO_REFERENCIA}${recuerdo.id}`,
    // vuelta automática y notificaciones solo con URLs HTTPS (en local: http://localhost)
    ...(/^https:\/\//.test(config.frontendUrl) ? { auto_return: "approved" } : {}),
    ...(config.notificationUrl ? { notification_url: config.notificationUrl } : {}),
    // Con precio de prueba, la preferencia deja de poder pagarse al terminar la ventana
    ...(precio.prueba ? { expires: true, expiration_date_to: precio.hastaIso } : {}),
  };
}

/* =========================
   GET /api/precios (lo que muestra el frontend)
   Sesión opcional: solo cambia algo para un email habilitado en el precio de prueba.
========================= */
router.get("/precios", auth, (req, res) => {
  const precios = {};
  for (const pack of Object.keys(PRECIOS)) {
    const p = precioACobrar(pack, req.user?.email);
    precios[pack] = { monto: p.monto, moneda: p.moneda, nombre: p.nombre };
  }
  // Con sesión la respuesta puede ser personal: no se guarda en caché
  res.set("Vary", "Authorization");
  res.set("Cache-Control", req.user ? "private, no-store" : "public, max-age=300");
  res.json(precios);
});

/* =========================
   POST /api/crear-preferencia
   El importe sale del pack guardado en el recuerdo; el body solo trae el id.
========================= */
router.post("/crear-preferencia", auth, requireAuth, async (req, res) => {
  try {
    const { recuerdoId } = req.body || {};

    if (!recuerdoId) {
      return res.status(400).json({ error: "Falta recuerdoId" });
    }

    // 🔎 Buscar recuerdo real
    const recuerdo = isUuid(recuerdoId)
      ? await prisma.recuerdo.findUnique({ where: { id: recuerdoId } })
      : null;

    if (!recuerdo) {
      return res.status(404).json({ error: "Recuerdo no encontrado" });
    }

    if (recuerdo.userId !== req.user.id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    if (recuerdo.pagado) {
      return res.status(409).json({ error: "Este recuerdo ya está pago" });
    }

    // Fuera de producción solo credenciales de prueba (TEST- o de una cuenta de prueba):
    // la credencial de la cuenta real crearía cobros reales desde una PC local
    if (!(await credencialPermitida())) {
      console.warn("Preferencia bloqueada: la credencial de Mercado Pago no es de prueba y el entorno no es producción");
      return res.status(503).json({ error: "Pagos deshabilitados en este entorno" });
    }

    const pack = recuerdo.pack || "individual";
    // El dueño ya se verificó arriba (recuerdo.userId === req.user.id)
    const precio = precioACobrar(pack, req.user.email);

    if (!precio) {
      return res.status(400).json({ error: "Pack inválido" });
    }

    if (precio.prueba) {
      console.warn(`⚠️ PRECIO DE PRUEBA: recuerdo ${recuerdo.id} · ${pack} · ${precio.monto} ${precio.moneda} (vence ${precio.hastaIso})`);
    }

    // Se fija el importe ANTES de crear la preferencia: el webhook valida contra este valor
    await prisma.recuerdo.update({
      where: { id: recuerdo.id },
      data: {
        montoEsperado: precio.monto,
        moneda: precio.moneda,
        preferenciaCreadaEn: new Date()
      }
    });

    console.log("🟡 Creando preferencia:", { recuerdoId: recuerdo.id, pack, monto: precio.monto });

    const preference = new Preference(client);

    const result = await preference.create({
      body: cuerpoPreferencia(recuerdo, pack, precio),
    });

    if (!result || !result.init_point) {
      throw new Error("Respuesta inválida de Mercado Pago");
    }

    await prisma.recuerdo.update({
      where: { id: recuerdo.id },
      data: { preferenciaId: result.id ? String(result.id).slice(0, 64) : null }
    });

    res.json({
      id: result.id,
      init_point: result.init_point,
    });

  } catch (error) {
    console.error("🔥 ERROR MP:", error.message);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

module.exports = router;
module.exports.cuerpoPreferencia = cuerpoPreferencia;
