const express = require("express");
const { Preference } = require("mercadopago");
const client = require("../config/mercadopago");

const router = express.Router();

router.post("/crear-preferencia", async (req, res) => {
  try {
    const { titulo, recuerdoId } = req.body;

    const preference = new Preference(client);

    const response = await preference.create({
      body: {
        items: [
          {
            title: titulo,
            quantity: 1,
            unit_price: 100, // $100 test
            currency_id: "ARS",
          },
        ],
        metadata: {
          recuerdo_id: recuerdoId,
        },
        back_urls: {
          success: "http://localhost:5500/exito.html",
          failure: "http://localhost:5500/error.html",
        },
        notification_url: "https://TU_NGROK_URL/api/webhook",
        // ❌ auto_return ELIMINADO
      },
    });

    res.json({
      id: response.id,
      init_point: response.init_point,
    });

  } catch (error) {
    console.error("ERROR MP FULL:", error);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

module.exports = router;
