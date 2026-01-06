const express = require("express");
const fs = require("fs");
const path = require("path");
const { Payment } = require("mercadopago");
const client = require("../config/mercadopago");

const router = express.Router();
const DATA_PATH = path.join(__dirname, "../data/recuerdos.json");

router.post("/webhook", async (req, res) => {
  try {
    if (req.body.type !== "payment") {
      return res.sendStatus(200);
    }

    const paymentId = req.body.data.id;

    // 🔥 CONSULTAR EL PAGO REAL
    const payment = new Payment(client);
    const response = await payment.get({ id: paymentId });

    const pago = response;

    // Solo si está aprobado
    if (pago.status !== "approved") {
      return res.sendStatus(200);
    }

    const recuerdoId = pago.metadata?.recuerdo_id;

    if (!recuerdoId) {
      console.log("Pago aprobado pero sin recuerdo_id");
      return res.sendStatus(200);
    }

    const recuerdos = JSON.parse(fs.readFileSync(DATA_PATH));
    const index = recuerdos.findIndex(r => r.id === recuerdoId);

    if (index === -1) {
      console.log("Recuerdo no encontrado:", recuerdoId);
      return res.sendStatus(200);
    }

    recuerdos[index].estado = "activo";
    recuerdos[index].pagado = true;
    recuerdos[index].payment_id = paymentId;

    fs.writeFileSync(DATA_PATH, JSON.stringify(recuerdos, null, 2));

    console.log("✅ Recuerdo activado:", recuerdoId);

    res.sendStatus(200);

  } catch (error) {
    console.error("❌ Error en webhook:", error);
    res.sendStatus(500);
  }
});

module.exports = router;
