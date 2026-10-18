// API de conversiones de Meta: armado del evento y envío. No usa base de datos ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { eventoNavegacion, eventoInicioPago, eventoCompra, enviarEvento, datosNavegador, hash } = require("../../services/metaCapi");

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
  const req = { body: { fbp: "fb.1.1760000000000.123456789", fbc: 123 }, ip: "127.0.0.1", get: h => cabeceras[h] };
  assert.deepEqual(JSON.parse(JSON.stringify(datosNavegador(req))), { meta_fbp: "fb.1.1760000000000.123456789", meta_ip: "9.9.9.9", meta_ua: "UA" });
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

test("InitiateCheckout con el mismo event_id que el pixel de pago.html", () => {
  const e = eventoInicioPago({
    recuerdo: RECUERDO,
    navegador: { meta_fbp: "fb.1.1.2", meta_ip: "1.2.3.4", meta_ua: "Mozilla" },
    email: "Ana@Example.com",
    userId: "u-1",
    monto: 21990,
    moneda: "ARS",
    sitio: "https://www.reqrdito.com",
    ahora: AHORA
  });
  assert.equal(e.event_name, "InitiateCheckout");
  assert.equal(e.event_id, `checkout_${RECUERDO.id}`);
  assert.equal(e.event_time, AHORA / 1000);
  assert.equal(e.event_source_url, "https://www.reqrdito.com/pago.html");
  assert.deepEqual(e.user_data, {
    em: [hash("ana@example.com")], external_id: [hash("u-1")],
    client_ip_address: "1.2.3.4", client_user_agent: "Mozilla", fbp: "fb.1.1.2"
  });
  assert.deepEqual(e.custom_data, {
    value: 21990, currency: "ARS", content_ids: ["pareja"], content_type: "product", num_items: 1
  });
});

test("datosNavegador descarta cookies _fbp/_fbc sin el formato de Meta", () => {
  const req = b => ({ body: b, ip: "1.1.1.1", get: () => undefined });
  const fbc = "fb.1.1760000000000.IwAR2abc_DEF-123";
  assert.equal(datosNavegador(req({ fbc })).meta_fbc, fbc);
  assert.equal(datosNavegador(req({ fbp: "fb.1.1760000000000.123.Ab" })).meta_fbp, "fb.1.1760000000000.123.Ab");
  for (const malo of ["undefined", "fb.1.x", "", "fb.1.1760000000000.<b>", "x".repeat(600)]) {
    assert.equal(datosNavegador(req({ fbp: malo, fbc: malo })).meta_fbp, undefined, malo);
    assert.equal(datosNavegador(req({ fbp: malo, fbc: malo })).meta_fbc, undefined, malo);
  }
});

const NAV = { meta_fbp: "fb.1.1760000000000.123", meta_ip: "1.2.3.4", meta_ua: "Mozilla" };
const SITIO = "https://www.reqrdito.com";

test("PageView del navegador: mismo event_id, URL del sitio y datos de navegador", () => {
  const e = eventoNavegacion({
    nombre: "PageView", eventId: "pv_0b6a3c1e-1111-4222-8333-444455556666",
    url: "https://reqrdito.com/recuerdo.html?id=1", navegador: NAV, sitio: SITIO, ahora: AHORA
  });
  assert.deepEqual(e, {
    event_name: "PageView",
    event_time: AHORA / 1000,
    event_id: "pv_0b6a3c1e-1111-4222-8333-444455556666",
    action_source: "website",
    event_source_url: "https://reqrdito.com/recuerdo.html?id=1",
    user_data: { client_ip_address: "1.2.3.4", client_user_agent: "Mozilla", fbp: "fb.1.1760000000000.123" }
  });
});

test("ViewContent lleva los datos fijados por el servidor", () => {
  const e = eventoNavegacion({ nombre: "ViewContent", eventId: "ev_abcdefgh", url: `${SITIO}/crear-recuerdo.html`, navegador: NAV, sitio: SITIO });
  assert.deepEqual(e.custom_data, { content_name: "Crear recuerdo", content_type: "product" });
});

test("eventoNavegacion rechaza compras, ids raros y páginas de otros sitios", () => {
  const base = { eventId: "pv_abcdefgh", url: `${SITIO}/`, navegador: NAV, sitio: SITIO };
  for (const nombre of ["Purchase", "InitiateCheckout", "toString", "__proto__", undefined]) {
    assert.equal(eventoNavegacion({ ...base, nombre }), null, nombre);
  }
  for (const eventId of ["corto", "con espacios 123", "x".repeat(81), 12345678]) {
    assert.equal(eventoNavegacion({ ...base, nombre: "PageView", eventId }), null, String(eventId));
  }
  for (const url of ["https://evil.com/", "http://www.reqrdito.com/", "https://reqrdito.com.evil.com/", "no-es-url", undefined]) {
    assert.equal(eventoNavegacion({ ...base, nombre: "PageView", url }), null, String(url));
  }
});
