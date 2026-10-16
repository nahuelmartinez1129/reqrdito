const express = require("express");
const { Preference } = require("mercadopago");
const client = require("../config/mercadopago");
const Recuerdo = require("../models/Recuerdo");

const router = express.Router();

const PRECIOS = {
  individual: 6900,
  pareja: 10900
};

router.post("/crear-preferencia", async (req, res) => {
  try {
    const { recuerdoId } = req.body;

    if (!recuerdoId) {
      return res.status(400).json({ error: "Falta recuerdoId" });
    }

    // 🔎 Buscar recuerdo real
    const recuerdo = await Recuerdo.findOne({ recuerdoId });

    if (!recuerdo) {
      return res.status(404).json({ error: "Recuerdo no encontrado" });
    }

    const pack = recuerdo.pack || "individual";
    const precio = PRECIOS[pack];

    if (!precio) {
      return res.status(400).json({ error: "Pack inválido" });
    }

    console.log("🟡 Creando preferencia:", {
      recuerdoId,
      pack,
      precio
    });

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            title:
              pack === "pareja"
                ? "Recuerdo QR – Pareja / Amigo"
                : "Recuerdo QR – Individual",
            quantity: 1,
            unit_price: precio,
            currency_id: "ARS",
          },
        ],

        metadata: {
          recuerdo_id: recuerdoId,
          pack: pack
        },

        back_urls: {
          success: "https://reqrdito.com/pago-exito.html",
          failure: "https://reqrdito.com/pago-error.html",
          pending: "https://reqrdito.com/pago-pendiente.html",
        },

        auto_return: "approved",
        external_reference: `REQRDITO_${recuerdoId}`,
        notification_url: "https://api.reqrdito.com/api/webhook",
      },
    });

    if (!result || !result.init_point) {
      throw new Error("Respuesta inválida de Mercado Pago");
    }

    res.json({
      id: result.id,
      init_point: result.init_point,
    });

  } catch (error) {
    console.error("🔥 ERROR MP:", error);
    res.status(500).json({
      error: "Error creando preferencia",
      detalle: error.message,
    });
  }
});

module.exports = router;
