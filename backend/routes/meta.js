const express = require("express");
const { config } = require("../config/env");
const metaCapi = require("../services/metaCapi");

const router = express.Router();

/* =========================
   Límite por IP: una persona navegando genera pocas páginas por minuto;
   más que esto es un script y no se reenvía a Meta.
========================= */
const VENTANA_MS = 5 * 60 * 1000;
const MAX_POR_VENTANA = 60;
const pedidos = new Map(); // ip -> { desde, cantidad }

function dentroDelLimite(ip, ahora = Date.now()) {
  if (pedidos.size > 10000) {
    for (const [clave, v] of pedidos) if (ahora - v.desde > VENTANA_MS) pedidos.delete(clave);
  }
  const actual = pedidos.get(ip);
  if (!actual || ahora - actual.desde > VENTANA_MS) {
    pedidos.set(ip, { desde: ahora, cantidad: 1 });
    return true;
  }
  actual.cantidad++;
  return actual.cantidad <= MAX_POR_VENTANA;
}

/* =========================
   POST /api/meta/evento
   Copia por la API de conversiones de un PageView o ViewContent que el pixel ya
   registró en el navegador (js/meta.js), con el mismo event_id para que Meta lo
   cuente una sola vez. Las compras e inicios de pago NO pasan por acá: los manda
   el backend al crear la preferencia y al confirmar el pago.
   Responde 204 sin esperar a Meta; un evento inválido se descarta en silencio.
========================= */
router.post("/meta/evento", (req, res) => {
  const navegador = metaCapi.datosNavegador(req);

  if (!dentroDelLimite(navegador.meta_ip || "sin-ip")) {
    return res.sendStatus(429);
  }

  const { evento: nombre, eventId, url } = req.body || {};
  const evento = metaCapi.eventoNavegacion({ nombre, eventId, url, navegador, sitio: config.frontendUrl });

  if (!evento) {
    return res.sendStatus(400);
  }

  // Sin await: enviarEvento nunca lanza y el navegador no espera a Meta
  metaCapi.enviarEvento(evento);
  res.sendStatus(204);
});

module.exports = router;
module.exports.reiniciarLimite = () => pedidos.clear();
