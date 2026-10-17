const express = require("express");
const { Payment } = require("mercadopago");
const client = require("../config/mercadopago");
const { procesarPago } = require("../services/pagos");

const router = express.Router();
const payment = new Payment(client);

// Notificaciones de Mercado Pago: webhooks ({type, data: {id}}) e IPN (?topic=&id=).
// Responde 200 a todo lo que no hay que reintentar y 500 cuando conviene que
// Mercado Pago reintente (su API, la base o el email fallaron).
router.post("/webhook", async (req, res) => {
  const tipo = req.body?.type || req.body?.topic || req.query.type || req.query.topic;
  const paymentId = req.body?.data?.id || req.query["data.id"] || (tipo === "payment" ? req.query.id : undefined);

  // merchant_order, chargebacks, etc.: no aplican a recuerdos
  if (tipo && tipo !== "payment") {
    console.log(`📨 Webhook ignorado: tipo ${String(tipo).slice(0, 30)}`);
    return res.sendStatus(200);
  }

  if (!paymentId) {
    console.log("📨 Webhook sin id de pago: ignorado");
    return res.sendStatus(200);
  }

  try {
    // procesarPago registra el resultado (estado del pago en Mercado Pago, recuerdo, etc.)
    await procesarPago(paymentId, payment, { origen: "webhook" });
    res.sendStatus(200);
  } catch (err) {
    console.error("🔥 WEBHOOK ERROR:", err.message);
    res.sendStatus(500);
  }
});


module.exports = router;
