const express = require("express");
const { Preference } = require("mercadopago");
const client = require("../config/mercadopago");
const prisma = require("../db/prisma");
const auth = require("../middleware/auth");
const requireAuth = require("../middleware/requireAuth");
const { config } = require("../config/env");
const { PRECIOS, precioDe } = require("../config/precios");
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
  };
}

/* =========================
   GET /api/precios (lo que muestra el frontend)
========================= */
router.get("/precios", (req, res) => {
  const precios = {};
  for (const [pack, p] of Object.entries(PRECIOS)) {
    precios[pack] = { monto: p.monto, moneda: p.moneda, nombre: p.nombre };
  }
  res.set("Cache-Control", "public, max-age=300");
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
    const precio = precioDe(pack);

    if (!precio) {
      return res.status(400).json({ error: "Pack inválido" });
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
