const express = require("express");
const { Payment } = require("mercadopago");
const client = require("../config/mercadopago");
const Recuerdo = require("../models/Recuerdo");
const enviarEmail = require("../utils/enviarEmail");

const router = express.Router();
const payment = new Payment(client);

router.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;

    if (!paymentId) {
      return res.sendStatus(200);
    }

    const info = await payment.get({ id: paymentId });

    if (info.status !== "approved") {
      return res.sendStatus(200);
    }

    const externalRef = info.external_reference;

    if (!externalRef || !externalRef.startsWith("REQRDITO_")) {
      console.warn("⚠️ External reference inválida:", externalRef);
      return res.sendStatus(200);
    }

    const recuerdoId = externalRef.replace("REQRDITO_", "");

    // 🔎 Buscar recuerdo por ID real
    const recuerdo = await Recuerdo.findOne({ recuerdoId });


    if (!recuerdo) {
      console.error("❌ No se encontró el recuerdo:", recuerdoId);
      return res.sendStatus(200);
    }

    // 🛑 Webhook duplicado
    if (recuerdo.pagado) {
      console.log("ℹ️ Webhook duplicado ignorado:", recuerdoId);
      return res.sendStatus(200);
    }

    // ✅ Marcar pago
    recuerdo.pagado = true;
    recuerdo.payment_id = paymentId;
    recuerdo.payerEmail = info.payer?.email || null;

    await recuerdo.save();

    // 📧 Mail al dueño del recuerdo
    await enviarEmail(recuerdo.userEmail, recuerdo.recuerdoId);


    console.log("🟢 Pago confirmado:", recuerdo._id);

    res.sendStatus(200);

  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err);
    res.sendStatus(500);
  }
});


module.exports = router;
