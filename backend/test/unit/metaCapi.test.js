// API de conversiones de Meta: armado del evento y envío. No usa base de datos ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { eventoCompra, enviarEvento, datosNavegador, hash } = require("../../services/metaCapi");

const RECUERDO = { id: "11111111-2222-4333-8444-555555555555", pack: "pareja" };
const AHORA = Date.parse("2026-10-17T20:00:00Z");

function evento(pago = {}) {
  return eventoCompra({
    recuerdo: RECUERDO,
    pago,
    emailDueno: " Ana@Example.com ",
    userId: "u-1",
    monto: 21990,
    moneda: "ARS",
    sitio: "https://www.reqrdito.com",
    ahora: AHORA
  });
}

test("Purchase con el mismo event_id que el pixel del navegador", () => {
  const e = evento();
  assert.equal(e.event_name, "Purchase");
  assert.equal(e.event_id, `purchase_${RECUERDO.id}`);
  assert.equal(e.action_source, "website");
  assert.equal(e.event_source_url, "https://www.reqrdito.com/pago-exito.html");
  assert.deepEqual(e.custom_data, {
    value: 21990, currency: "ARS", content_ids: ["pareja"], content_type: "product", num_items: 1
  });
});

test("emails e id de usuario van con hash SHA-256 normalizado y sin repetir", () => {
  const e = evento({ payer: { email: "ana@example.com" } });
  assert.deepEqual(e.user_data.em, [hash("ana@example.com")]);
  assert.match(e.user_data.em[0], /^[0-9a-f]{64}$/);
  assert.deepEqual(e.user_data.external_id, [hash("u-1")]);
  assert.ok(!JSON.stringify(e).includes("example.com"));
});

test("usa los datos del navegador guardados en la metadata del pago", () => {
  const e = evento({ metadata: { meta_fbp: "fb.1.1.2", meta_fbc: "fb.1.1.abc", meta_ip: "1.2.3.4", meta_ua: "Mozilla" } });
  assert.equal(e.user_data.fbp, "fb.1.1.2");
  assert.equal(e.user_data.fbc, "fb.1.1.abc");
  assert.equal(e.user_data.client_ip_address, "1.2.3.4");
  assert.equal(e.user_data.client_user_agent, "Mozilla");
});

test("event_time: fecha de aprobación si es reciente, si no el momento actual", () => {
  const aprobado = "2026-10-17T19:00:00Z";
  assert.equal(evento({ date_approved: aprobado }).event_time, Date.parse(aprobado) / 1000);
  assert.equal(evento({ date_approved: "2026-09-01T00:00:00Z" }).event_time, AHORA / 1000);
  assert.equal(evento({}).event_time, AHORA / 1000);
});

test("datosNavegador toma X-Real-IP (nginx) y las cookies del body", () => {
  const cabeceras = { "x-real-ip": "9.9.9.9", "user-agent": "UA" };
  const req = { body: { fbp: "fb.1.x", fbc: 123 }, ip: "127.0.0.1", get: h => cabeceras[h] };
  assert.deepEqual(JSON.parse(JSON.stringify(datosNavegador(req))), { meta_fbp: "fb.1.x", meta_ip: "9.9.9.9", meta_ua: "UA" });
});

test("sin META_PIXEL_ID o META_CAPI_TOKEN no se envía nada", async () => {
  let llamado = false;
  const fetchFn = async () => { llamado = true; };
  assert.equal(await enviarEvento(evento(), { env: { META_PIXEL_ID: "1" }, fetchFn }), "deshabilitado");
  assert.equal(llamado, false);
});

test("envía al pixel configurado con test_event_code opcional y nunca lanza", async () => {
  let url, cuerpo;
  const ok = async (u, o) => { url = u; cuerpo = JSON.parse(o.body); return { ok: true }; };
  const env = { META_PIXEL_ID: "123", META_CAPI_TOKEN: "tok", META_TEST_EVENT_CODE: "TEST1" };
  assert.equal(await enviarEvento(evento(), { env, fetchFn: ok }), "enviado");
  assert.match(url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\/123\/events\?access_token=tok$/);
  assert.equal(cuerpo.test_event_code, "TEST1");
  assert.equal(cuerpo.data[0].event_name, "Purchase");

  const mal = async () => ({ ok: false, status: 400, text: async () => "bad" });
  assert.equal(await enviarEvento(evento(), { env, fetchFn: mal }), "error");
  const caido = async () => { throw new Error("red"); };
  assert.equal(await enviarEvento(evento(), { env, fetchFn: caido }), "error");
});
