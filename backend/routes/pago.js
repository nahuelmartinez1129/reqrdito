const express = require("express");
const { Preference } = require("mercadopago");
const client = require("../config/mercadopago");

const router = express.Router();

router.post("/crear-preferencia", async (req, res) => {
  try {
    const { titulo, recuerdoId, email } = req.body;

    console.log("🟡 Creando preferencia para:", recuerdoId);

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            title: titulo,
            quantity: 1,
            unit_price: 6900,
            currency_id: "ARS",
          },
        ],
        payer: {
          email: email || "comprador@test.com",
        },
        metadata: {
          recuerdo_id: recuerdoId,
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

    // 🔥 SDK NUEVO: los datos vienen DIRECTO en result
    console.log("🟢 Preferencia creada:", result);

    if (!result || !result.id || !result.init_point) {
      throw new Error("Respuesta inválida de Mercado Pago");
    }

    res.json({
      id: result.id,
      init_point: result.init_point,
    });

  } catch (error) {
    console.error("🔥 ERROR MP REAL:", error);
    res.status(500).json({
      error: "Error creando preferencia",
      detalle: error.message,
    });
  }
});

module.exports = router;

