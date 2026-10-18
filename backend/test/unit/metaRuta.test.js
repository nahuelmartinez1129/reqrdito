// POST /api/meta/evento: valida, limita por IP y reenvía a la API de conversiones.
// Monta solo el router (sin base de datos); enviarEvento se reemplaza: no sale nada a Meta.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const metaCapi = require("../../services/metaCapi");
const metaRoutes = require("../../routes/meta");

const enviados = [];
const original = metaCapi.enviarEvento;
let server, base;

before(async () => {
  metaCapi.enviarEvento = async (e) => { enviados.push(e); return "enviado"; };
  const app = express();
  app.use(express.json());
  app.use("/api", metaRoutes);
  server = await new Promise(r => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { metaCapi.enviarEvento = original; server.close(); });
beforeEach(() => { enviados.length = 0; metaRoutes.reiniciarLimite(); });

function enviar(body, ip = "9.9.9.9") {
  return fetch(`${base}/api/meta/evento`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Real-IP": ip, "User-Agent": "Mozilla/5.0 prueba" },
    body: JSON.stringify(body)
  });
}

const PAGE_VIEW = {
  evento: "PageView", eventId: "pv_0b6a3c1e-1111-4222-8333-444455556666",
  url: "https://www.reqrdito.com/", fbp: "fb.1.1760000000000.987654321"
};

test("reenvía el PageView con el event_id del pixel, la IP de nginx y el user agent", async () => {
  const res = await enviar(PAGE_VIEW);
  assert.equal(res.status, 204);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].event_id, PAGE_VIEW.eventId);
  assert.deepEqual(enviados[0].user_data, {
    client_ip_address: "9.9.9.9", client_user_agent: "Mozilla/5.0 prueba", fbp: PAGE_VIEW.fbp
  });
});

test("no acepta Purchase ni InitiateCheckout desde el navegador", async () => {
  for (const evento of ["Purchase", "InitiateCheckout"]) {
    assert.equal((await enviar({ ...PAGE_VIEW, evento })).status, 400);
  }
  assert.equal((await enviar({})).status, 400);
  assert.equal(enviados.length, 0);
});

test("más de 60 eventos en 5 minutos desde la misma IP no se reenvían", async () => {
  for (let i = 0; i < 60; i++) assert.equal((await enviar(PAGE_VIEW)).status, 204);
  assert.equal((await enviar(PAGE_VIEW)).status, 429);
  assert.equal((await enviar(PAGE_VIEW, "8.8.8.8")).status, 204);
  assert.equal(enviados.length, 61);
});
