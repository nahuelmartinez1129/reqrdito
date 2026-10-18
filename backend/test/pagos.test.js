// Pagos: importe, moneda, pack, idempotencia, tarifa histórica y email durable.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const h = require("./helpers");
const { api, prisma } = h;

const archivosCreados = [];
const subirRecuerdo = h.crearSubidor(archivosCreados);

before(async () => { await h.iniciar(); });
after(async () => {
  h.borrarArchivosSubidos(archivosCreados);
  await h.detener();
});
beforeEach(async () => { await h.limpiarBase(); });

// Recuerdo impago con preferencia creada por el backend (importe fijado)
async function conPreferencia(pack = "individual", email = "ana@example.com") {
  const token = await h.login(email);
  const { data } = await subirRecuerdo(token, { pack, dosAudios: pack === "pareja" });
  const res = await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: data.id } });
  assert.equal(res.status, 200);
  return { token, id: data.id };
}

async function estado(id) {
  return prisma.recuerdo.findUnique({ where: { id } });
}

describe("Preferencias: el importe lo fija el backend", () => {

  test("Individual genera una preferencia por exactamente $11.990 ARS y lo registra", async () => {
    const { id } = await conPreferencia("individual");
    const item = h.mp.preferencias[0].items;
    assert.equal(item.length, 1);
    assert.equal(item[0].unit_price, 11990);
    assert.equal(item[0].quantity, 1);
    assert.equal(item[0].currency_id, "ARS");

    const r = await estado(id);
    assert.equal(r.montoEsperado, 11990);
    assert.equal(r.moneda, "ARS");
    assert.ok(r.preferenciaCreadaEn);
    assert.equal(r.preferenciaId, "pref-1");
  });

  test("Dúo genera una preferencia por exactamente $14.990 ARS", async () => {
    const { id } = await conPreferencia("pareja");
    assert.equal(h.mp.preferencias[0].items[0].unit_price, 14990);
    assert.equal(h.mp.preferencias[0].items[0].currency_id, "ARS");
    assert.equal((await estado(id)).montoEsperado, 14990);
  });

  test("el navegador no puede manipular el importe, la moneda ni el pack", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);
    const res = await api("/api/crear-preferencia", {
      method: "POST", token,
      json: { recuerdoId: data.id, precio: 1, unit_price: 1, monto: 1, pack: "pareja", currency_id: "USD", items: [{ unit_price: 1 }] }
    });
    assert.equal(res.status, 200);
    const item = h.mp.preferencias[0].items[0];
    assert.equal(item.unit_price, 11990);
    assert.equal(item.currency_id, "ARS");
    assert.equal(h.mp.preferencias[0].items.length, 1);
  });

  test("solo el dueño puede crear la preferencia de su recuerdo", async () => {
    const { id } = await conPreferencia();
    h.mp.preferencias.length = 0;
    const beto = await h.login("beto@example.com");
    assert.equal((await api("/api/crear-preferencia", { method: "POST", token: beto, json: { recuerdoId: id } })).status, 403);
    assert.equal((await api("/api/crear-preferencia", { method: "POST", json: { recuerdoId: id } })).status, 401);
    assert.equal(h.mp.preferencias.length, 0);
  });

  test("la preferencia permite pagar como invitado con tarjeta de crédito o débito", async () => {
    await conPreferencia("individual");
    const body = h.mp.preferencias[0];
    // purpose "wallet_purchase" obligaría a iniciar sesión en Mercado Pago
    assert.equal(body.purpose, undefined);
    const excluidos = (body.payment_methods?.excluded_payment_types || []).map(t => t.id);
    assert.ok(!excluidos.includes("credit_card"), "no excluye crédito");
    assert.ok(!excluidos.includes("debit_card"), "no excluye débito");
    // ningún dato de tarjeta ni del pagador viaja desde nuestro servidor
    assert.equal(body.payer, undefined);
    assert.equal(body.notification_url.endsWith("/api/webhook"), true);
  });

  test("fuera de producción una credencial APP_USR de una cuenta de prueba sí crea preferencias", async () => {
    const { verificador } = require("../services/mpCredencial");
    const previo = process.env.MP_ACCESS_TOKEN;
    const original = verificador.esCuentaDePrueba;
    process.env.MP_ACCESS_TOKEN = "APP_USR-vendedor-de-prueba";
    verificador.esCuentaDePrueba = async () => true;
    try {
      await conPreferencia("individual");
      assert.equal(h.mp.preferencias.length, 1);
    } finally {
      process.env.MP_ACCESS_TOKEN = previo;
      verificador.esCuentaDePrueba = original;
    }
  });

  test("fuera de producción una credencial APP_USR de la cuenta real no puede crear preferencias", async () => {
    const { verificador } = require("../services/mpCredencial");
    const previo = process.env.MP_ACCESS_TOKEN;
    const original = verificador.esCuentaDePrueba;
    process.env.MP_ACCESS_TOKEN = "APP_USR-credencial-falsa";
    verificador.esCuentaDePrueba = async () => false;
    try {
      const token = await h.login("ana@example.com");
      const { data } = await subirRecuerdo(token);
      const res = await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: data.id } });
      assert.equal(res.status, 503);
      assert.equal(h.mp.preferencias.length, 0, "no se llamó a Mercado Pago");
      assert.equal((await estado(data.id)).montoEsperado, null);
    } finally {
      process.env.MP_ACCESS_TOKEN = previo;
      verificador.esCuentaDePrueba = original;
    }
  });

  test("un error de Mercado Pago no expone detalles internos", async () => {
    const mercadopago = require("mercadopago");
    const original = mercadopago.Preference.prototype.create;
    mercadopago.Preference.prototype.create = async () => { throw new Error("secreto interno 42"); };
    try {
      const token = await h.login("ana@example.com");
      const { data } = await subirRecuerdo(token);
      const res = await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: data.id } });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { error: "Error creando preferencia" });
    } finally {
      mercadopago.Preference.prototype.create = original;
    }
  });
});

describe("Webhook: validación del pago real", () => {

  test("importe inferior, superior o con otra moneda no marca el recuerdo como pagado", async () => {
    const { id } = await conPreferencia("individual");
    h.pagoAprobado("101", id, { monto: 11989 });
    h.pagoAprobado("102", id, { monto: 11991 });
    h.pagoAprobado("103", id, { monto: 6900 });          // tarifa anterior: no vale para preferencias nuevas
    h.pagoAprobado("104", id, { monto: 11990, moneda: "USD" });
    h.pagoAprobado("105", id, { monto: 14990 });         // precio de otro pack

    for (const p of ["101", "102", "103", "104", "105"]) {
      assert.equal((await h.webhook(p)).status, 200, p);
    }

    const r = await estado(id);
    assert.equal(r.pagado, false);
    assert.equal(r.paymentId, null);
    assert.equal(h.emails.length, 0);

    const revision = await prisma.pagoRevision.findMany({ orderBy: { paymentId: "asc" } });
    assert.deepEqual(revision.map(p => [p.paymentId, p.motivo]), [
      ["101", "importe_incorrecto"], ["102", "importe_incorrecto"], ["103", "importe_incorrecto"],
      ["104", "moneda_incorrecta"], ["105", "importe_incorrecto"]
    ]);
    assert.ok(revision.every(p => p.recuerdoId === id && p.montoEsperado === 11990));

    // el pago correcto posterior sí se aplica
    h.pagoAprobado("106", id, { monto: 11990 });
    await h.webhook("106");
    assert.equal((await estado(id)).pagado, true);
  });

  test("Dúo valida contra $14.990 (el importe de Individual no alcanza)", async () => {
    const { id } = await conPreferencia("pareja");
    h.pagoAprobado("201", id, { monto: 11990 });
    await h.webhook("201");
    assert.equal((await estado(id)).pagado, false);
    h.pagoAprobado("202", id, { monto: 14990 });
    await h.webhook("202");
    const r = await estado(id);
    assert.equal(r.pagado, true);
    assert.equal(Number(r.montoPagado), 14990);
  });

  test("importes con decimales equivalentes se aceptan (11990.00)", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("301", id, { monto: 11990.0 });
    await h.webhook("301");
    assert.equal((await estado(id)).pagado, true);
  });

  test("webhooks repetidos y simultáneos son idempotentes: un pago, un email", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("401", id, { monto: 11990 });
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => h.webhook("401")));
    assert.ok(respuestas.every(r => r.status === 200));
    await h.webhook("401");

    const r = await estado(id);
    assert.equal(r.pagado, true);
    assert.equal(r.paymentId, "401");
    assert.equal(h.emails.length, 1);
    assert.equal(await prisma.pagoRevision.count(), 0);
  });

  test("un segundo pago aprobado para un recuerdo ya pago queda registrado para revisión", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("501", id, { monto: 11990 });
    h.pagoAprobado("502", id, { monto: 11990 });
    await h.webhook("501");
    await h.webhook("502");
    await h.webhook("502");

    assert.equal((await estado(id)).paymentId, "501");
    const revision = await prisma.pagoRevision.findMany();
    assert.equal(revision.length, 1);
    assert.equal(revision[0].paymentId, "502");
    assert.equal(revision[0].motivo, "pago_duplicado");
    assert.equal(h.emails.length, 1);
  });

  test("formatos de notificación: IPN por query, merchant_order ignorado", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("601", id, { monto: 11990 });

    const mo = await api("/api/webhook?topic=merchant_order&id=601", { method: "POST" });
    assert.equal(mo.status, 200);
    assert.equal((await estado(id)).pagado, false);
    assert.equal(h.mp.consultas, 0);

    const ipn = await api("/api/webhook?topic=payment&id=601", { method: "POST" });
    assert.equal(ipn.status, 200);
    assert.equal((await estado(id)).pagado, true);
  });

  test("el body del webhook no se usa como fuente de verdad", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("701", id, { monto: 11990, status: "rejected" });
    const res = await api("/api/webhook", {
      method: "POST",
      json: { type: "payment", data: { id: "701" }, status: "approved", transaction_amount: 11990, external_reference: `REQRDITO_${id}` }
    });
    assert.equal(res.status, 200);
    assert.equal((await estado(id)).pagado, false);
  });
});

describe("Pagos históricos (preferencias sin importe registrado)", () => {

  // Simula un recuerdo cuya preferencia se creó antes de este cambio (monto_esperado NULL)
  async function recuerdoLegacy(pack) {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token, { pack, dosAudios: pack === "pareja" });
    return data.id;
  }

  test("se acepta la tarifa anterior o la vigente del pack y queda registrado para revisión", async () => {
    const ind = await recuerdoLegacy("individual");
    const duo = await recuerdoLegacy("pareja");
    h.pagoAprobado("801", ind, { monto: 6900 });
    h.pagoAprobado("802", duo, { monto: 21990 });
    await h.webhook("801");
    await h.webhook("802");

    const a = await estado(ind);
    const b = await estado(duo);
    assert.equal(a.pagado, true);
    assert.equal(Number(a.montoPagado), 6900);
    assert.equal(a.montoEsperado, null, "no se reescribe el importe histórico");
    assert.equal(b.pagado, true);

    const revision = await prisma.pagoRevision.findMany({ orderBy: { paymentId: "asc" } });
    assert.deepEqual(revision.map(p => [p.paymentId, p.motivo]), [["801", "sin_monto_registrado"], ["802", "sin_monto_registrado"]]);
  });

  test("un importe que no es ninguna tarifa del pack se rechaza también en preferencias viejas", async () => {
    const ind = await recuerdoLegacy("individual");
    h.pagoAprobado("901", ind, { monto: 10900 }); // tarifa anterior del Dúo
    h.pagoAprobado("902", ind, { monto: 100 });
    await h.webhook("901");
    await h.webhook("902");
    assert.equal((await estado(ind)).pagado, false);
    assert.equal(await prisma.pagoRevision.count({ where: { motivo: "importe_incorrecto" } }), 2);
  });

  test("los recuerdos ya pagados no se tocan al cambiar la tarifa", async () => {
    const ind = await recuerdoLegacy("individual");
    await prisma.recuerdo.update({ where: { id: ind }, data: { pagado: true, paymentId: "1000", montoPagado: 6900 } });
    h.pagoAprobado("1000", ind, { monto: 6900 });
    await h.webhook("1000");
    const r = await estado(ind);
    assert.equal(Number(r.montoPagado), 6900);
    assert.equal(r.paymentId, "1000");
    assert.equal(await prisma.pagoRevision.count(), 0);
  });
});

describe("Email de pago recuperable", () => {

  test("si el SMTP falla, el pago queda aplicado, el webhook pide reintento y el reintento envía una sola vez", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("1101", id, { monto: 11990 });

    h.emails.fallar = true;
    const primero = await h.webhook("1101");
    assert.equal(primero.status, 500, "Mercado Pago debe reintentar");

    let r = await estado(id);
    assert.equal(r.pagado, true, "el pago no se pierde");
    assert.equal(r.emailPagoEnviadoEn, null);
    assert.equal(r.emailPagoIntentos, 1);
    assert.equal(r.emailPagoIntentoEn, null, "el bloqueo se libera");

    h.emails.fallar = false;
    const segundo = await h.webhook("1101");
    assert.equal(segundo.status, 200);
    r = await estado(id);
    assert.ok(r.emailPagoEnviadoEn);
    assert.equal(r.emailPagoIntentos, 2);
    assert.equal(h.emails.length, 1);

    await h.webhook("1101");
    assert.equal(h.emails.length, 1, "no se duplica");
  });

  test("el script de reintento envía los pendientes sin duplicar", async () => {
    const { enviarEmailPendiente } = require("../services/pagos");
    const { id } = await conPreferencia();
    h.pagoAprobado("1201", id, { monto: 11990 });
    h.emails.fallar = true;
    await h.webhook("1201");
    h.emails.fallar = false;

    const resultados = await Promise.all([enviarEmailPendiente(id), enviarEmailPendiente(id)]);
    assert.equal(resultados.filter(r => r === "enviado").length, 1);
    assert.ok(resultados.every(r => ["enviado", "en_curso", "ya_enviado"].includes(r)));
    assert.equal(await enviarEmailPendiente(id), "ya_enviado");
    assert.equal(h.emails.length, 1);
  });

  test("con emails simulados (entorno local) el email queda pendiente, no se da por enviado", async () => {
    const emailService = require("../services/emailService.js");
    const original = emailService.sendEmail;
    emailService.sendEmail = async () => ({ enviado: false, simulado: true });
    try {
      const { id } = await conPreferencia();
      h.pagoAprobado("1301", id, { monto: 11990 });
      assert.equal((await h.webhook("1301")).status, 200);
      const r = await estado(id);
      assert.equal(r.pagado, true);
      assert.equal(r.emailPagoEnviadoEn, null);
    } finally {
      emailService.sendEmail = original;
    }
  });

  test("los llaveros prepagos no generan email de pago", async () => {
    const admin = await h.loginAdmin();
    await api("/api/keychain-admin/generar-individuales", { method: "POST", token: admin, json: { cantidad: 1 } });
    const k = await prisma.keychain.findFirst();
    const token = await h.login("ana@example.com");
    const { res } = await subirRecuerdo(token, { key: k.qrId });
    assert.equal(res.status, 200);
    assert.equal(h.emails.length, 0);
  });
});

describe("Confirmación del pago sin webhook de Mercado Pago (entorno local) y diagnóstico", () => {
  const { Payment } = require("mercadopago");
  const { conciliarPendientes } = require("../services/pagos");
  const payment = new Payment({});

  // Captura console.log/warn/error mientras corre fn
  async function capturarLogs(fn) {
    const lineas = [];
    const originales = { log: console.log, warn: console.warn, error: console.error };
    for (const k of Object.keys(originales)) console[k] = (...a) => lineas.push(a.join(" "));
    try { await fn(); } finally { Object.assign(console, originales); }
    return lineas.join("\n");
  }

  test("aviso local desde pago-exito (POST /api/webhook?type=payment&data.id=): activa el recuerdo y envía el email al dueño", async () => {
    const { id } = await conPreferencia("individual", "ana@example.com");
    h.pagoAprobado("2001", id, { monto: 11990, payer: "comprador-de-prueba@example.com" });

    const res = await api("/api/webhook?type=payment&data.id=2001", { method: "POST" });
    assert.equal(res.status, 200);

    const r = await estado(id);
    assert.equal(r.pagado, true);
    assert.equal(r.paymentId, "2001");
    assert.ok(r.emailPagoEnviadoEn);

    // el email va al dueño del recuerdo (cuenta de Google), con el link al recuerdo
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0].to, "ana@example.com");
    assert.equal(h.emails[0].template, "recuerdo-creado.html");
    assert.match(h.emails[0].variables.LINK_RECUERDO, new RegExp(`/recuerdo\\.html\\?id=${id}$`));

    // lo que consulta pago-exito.html antes de redirigir
    const publico = await (await api(`/api/recuerdo/${id}`)).json();
    assert.equal(publico.pagado, true);
  });

  test("antes de la confirmación del backend, el recuerdo figura impago (pago-exito no redirige)", async () => {
    const { id } = await conPreferencia();
    // pago aprobado en Mercado Pago pero sin webhook ni conciliación todavía
    h.pagoAprobado("2101", id, { monto: 11990 });
    assert.equal((await (await api(`/api/recuerdo/${id}`)).json()).pagado, false);
  });

  test("un id de pago inexistente en Mercado Pago no activa nada (no hay aprobación sin verificar)", async () => {
    const { id } = await conPreferencia();
    const res = await api("/api/webhook?type=payment&data.id=2201", { method: "POST" });
    assert.equal(res.status, 500, "Mercado Pago no lo conoce: se pide reintento");
    assert.equal((await estado(id)).pagado, false);
    assert.equal(h.emails.length, 0);
  });

  test("conciliación: encuentra el pago aprobado de una preferencia impaga y activa el recuerdo una sola vez", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("2301", id, { monto: 11990 });

    const simulacion = await conciliarPendientes(payment, { aplicar: false });
    assert.deepEqual(simulacion.map(r => [r.recuerdoId, r.paymentId, r.resultado]), [[id, "2301", "a_procesar"]]);
    assert.equal((await estado(id)).pagado, false, "la simulación no cambia nada");

    const aplicada = await conciliarPendientes(payment, { aplicar: true });
    assert.deepEqual(aplicada.map(r => r.resultado), ["pagado"]);
    assert.equal((await estado(id)).pagado, true);
    assert.equal(h.emails.length, 1);

    // segunda vuelta: ya no está pendiente
    assert.deepEqual(await conciliarPendientes(payment, { aplicar: true }), []);
    assert.equal(h.emails.length, 1);
  });

  test("conciliación: pagos rechazados o pendientes no activan el recuerdo", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("2401", id, { monto: 11990, status: "rejected" });
    h.pagoAprobado("2402", id, { monto: 11990, status: "in_process" });
    const r = await conciliarPendientes(payment, { aplicar: true });
    assert.deepEqual(r.map(x => [x.paymentId, x.resultado]).sort(), [["2401", "no_aprobado"], ["2402", "no_aprobado"]]);
    assert.equal((await estado(id)).pagado, false);
    assert.equal(h.emails.length, 0);
  });

  test("conciliación: la búsqueda no es fuente de verdad (si Payment.get dice rechazado, no se activa)", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("2501", id, { monto: 11990, status: "rejected" });
    // la búsqueda "dice" aprobado, pero procesarPago vuelve a consultar el pago
    h.mp.resultadosBusqueda = ref => [{ id: 2501, status: "approved", external_reference: ref, transaction_amount: 11990, currency_id: "ARS" }];
    const r = await conciliarPendientes(payment, { aplicar: true });
    assert.deepEqual(r.map(x => x.resultado), ["no_aprobado"]);
    assert.equal((await estado(id)).pagado, false);
  });

  test("conciliación: importe incorrecto queda en revisión y no se reprocesa en cada vuelta", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("2601", id, { monto: 100 });
    assert.deepEqual((await conciliarPendientes(payment, { aplicar: true })).map(x => x.resultado), ["revision"]);
    assert.deepEqual((await conciliarPendientes(payment, { aplicar: true })).map(x => x.resultado), ["en_revision"]);
    assert.equal((await estado(id)).pagado, false);
    assert.equal(await prisma.pagoRevision.count({ where: { paymentId: "2601" } }), 1);
  });

  test("conciliación: no toca recuerdos sin preferencia ni pagos de otro recuerdo", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);               // sin preferencia
    const { id: otro } = await conPreferencia("individual", "beto@example.com");
    h.pagoAprobado("2701", data.id, { monto: 11990 });         // referencia del recuerdo sin preferencia
    const r = await conciliarPendientes(payment, { aplicar: true });
    assert.deepEqual(r.map(x => [x.recuerdoId, x.resultado]), [[otro, "sin_pagos"]]);
    assert.equal((await estado(data.id)).pagado, false);
  });

  test("registros de diagnóstico: resultado y estado del pago, sin tokens ni emails completos", async () => {
    const { id } = await conPreferencia("individual", "ana@example.com");
    h.pagoAprobado("2801", id, { monto: 11990, payer: "comprador-secreto@example.com" });
    h.pagoAprobado("2802", id, { monto: 11990, status: "rejected" });

    const logs = await capturarLogs(async () => {
      await api("/api/webhook?type=payment&data.id=2802", { method: "POST" });
      await api("/api/webhook?type=payment&data.id=2801", { method: "POST" });
      await api("/api/webhook?topic=merchant_order&id=9", { method: "POST" });
    });

    assert.match(logs, /Pago 2802 \[webhook\] → no_aprobado · estado=rejected/);
    assert.match(logs, new RegExp(`Pago 2801 \\[webhook\\] → pagado · estado=approved recuerdo=${id}`));
    assert.match(logs, new RegExp(`Email de pago ${id} → a\\*\\*\\*@example\\.com: enviado`));
    assert.match(logs, /Webhook ignorado: tipo merchant_order/);
    assert.ok(!logs.includes("ana@example.com"), "sin el email del dueño completo");
    assert.ok(!logs.includes("comprador-secreto"), "sin el email del pagador");
    assert.ok(!logs.includes(process.env.MP_ACCESS_TOKEN), "sin el token de Mercado Pago");
  });

  test("registros: un fallo de SMTP queda registrado sin datos sensibles y el email sigue pendiente", async () => {
    const { id } = await conPreferencia("individual", "ana@example.com");
    h.pagoAprobado("2901", id, { monto: 11990 });
    h.emails.fallar = true;
    const logs = await capturarLogs(() => api("/api/webhook?type=payment&data.id=2901", { method: "POST" }));
    assert.match(logs, new RegExp(`Email de pago ${id} → a\\*\\*\\*@example\\.com: error \\(SMTP caído \\(simulado\\)\\)`));
    assert.ok(!logs.includes("ana@example.com"));
    const r = await estado(id);
    assert.equal(r.pagado, true);
    assert.equal(r.emailPagoEnviadoEn, null);
  });
});

describe("Precio temporal de prueba (Individual, solo producción)", () => {
  const ORIGINAL = {};
  const VARIABLES = ["NODE_ENV", "PRECIO_PRUEBA_INDIVIDUAL_ARS", "PRECIO_PRUEBA_HASTA", "PRECIO_PRUEBA_EMAILS"];
  const enHoras = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

  beforeEach(() => {
    for (const v of VARIABLES) ORIGINAL[v] = process.env[v];
    // Mercado Pago y el email están simulados (helpers.js): "production" no sale a la red
    process.env.NODE_ENV = "production";
    process.env.PRECIO_PRUEBA_INDIVIDUAL_ARS = "100";
    process.env.PRECIO_PRUEBA_HASTA = enHoras(2);
    process.env.PRECIO_PRUEBA_EMAILS = "ana@example.com";   // dueña por defecto de conPreferencia
  });
  after(() => {
    for (const v of VARIABLES) {
      if (ORIGINAL[v] === undefined) delete process.env[v]; else process.env[v] = ORIGINAL[v];
    }
  });

  test("el Individual se cobra $100 con preferencia que vence; el Dúo no cambia", async () => {
    // anónimo: precio oficial con caché pública
    const anonimo = await api("/api/precios");
    assert.equal(anonimo.headers.get("cache-control"), "public, max-age=300");
    assert.match(anonimo.headers.get("vary") || "", /Authorization/i);
    assert.equal((await anonimo.json()).individual.monto, 11990);

    // cuenta habilitada: precio de prueba, sin caché
    const precios = await api("/api/precios", { token: await h.login("ana@example.com") });
    assert.equal(precios.headers.get("cache-control"), "private, no-store");
    const body = await precios.json();
    assert.equal(body.individual.monto, 100);
    assert.equal(body.pareja.monto, 14990);

    const { id } = await conPreferencia("individual");
    const pref = h.mp.preferencias[0];
    assert.equal(pref.items[0].unit_price, 100);
    assert.equal(pref.items[0].currency_id, "ARS");
    assert.equal(pref.expires, true);
    assert.equal(pref.expiration_date_to, process.env.PRECIO_PRUEBA_HASTA);
    assert.equal((await estado(id)).montoEsperado, 100);

    const duo = await conPreferencia("pareja", "beto@example.com");
    assert.equal(h.mp.preferencias[1].items[0].unit_price, 14990);
    assert.equal(h.mp.preferencias[1].expires, undefined);
    assert.equal((await estado(duo.id)).montoEsperado, 14990);
  });

  test("durante la ventana, otra cuenta paga el precio oficial y $100 no le activa el recuerdo", async () => {
    const otra = await h.login("cliente@example.com");
    assert.equal((await (await api("/api/precios", { token: otra })).json()).individual.monto, 11990);

    const { id } = await conPreferencia("individual", "cliente@example.com");
    assert.equal(h.mp.preferencias[0].items[0].unit_price, 11990);
    assert.equal(h.mp.preferencias[0].expires, undefined);
    assert.equal((await estado(id)).montoEsperado, 11990);

    h.pagoAprobado("3051", id, { monto: 100 });
    await h.webhook("3051");
    assert.equal((await estado(id)).pagado, false);
  });

  test("el webhook acepta solo los $100 de la preferencia de prueba", async () => {
    const { id } = await conPreferencia("individual");
    h.pagoAprobado("3001", id, { monto: 99 });
    h.pagoAprobado("3002", id, { monto: 11990 });
    h.pagoAprobado("3003", id, { monto: 100, moneda: "USD" });
    for (const p of ["3001", "3002", "3003"]) await h.webhook(p);
    assert.equal((await estado(id)).pagado, false);

    h.pagoAprobado("3004", id, { monto: 100 });
    await h.webhook("3004");
    await h.webhook("3004"); // notificación repetida
    const r = await estado(id);
    assert.equal(r.pagado, true);
    assert.equal(r.paymentId, "3004");
    assert.equal(Number(r.montoPagado), 100);
    assert.equal(h.emails.length, 1, "un solo email aunque se repita la notificación");
  });

  test("al vencer vuelve el precio oficial y $100 ya no paga un recuerdo nuevo", async () => {
    process.env.PRECIO_PRUEBA_HASTA = enHoras(-0.01);
    assert.equal((await (await api("/api/precios")).json()).individual.monto, 11990);

    const { id } = await conPreferencia("individual");
    assert.equal(h.mp.preferencias[0].items[0].unit_price, 11990);
    assert.equal(h.mp.preferencias[0].expires, undefined);

    h.pagoAprobado("3101", id, { monto: 100 });
    await h.webhook("3101");
    assert.equal((await estado(id)).pagado, false);
    const revision = await prisma.pagoRevision.findMany();
    assert.deepEqual(revision.map(p => [p.paymentId, p.motivo]), [["3101", "importe_incorrecto"]]);
  });

  test("con el precio de prueba activo, $100 no paga recuerdos históricos sin importe registrado", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token, { pack: "individual" });
    h.pagoAprobado("3201", data.id, { monto: 100 });
    await h.webhook("3201");
    assert.equal((await estado(data.id)).pagado, false);
  });

  test("una ventana mayor a 72 h se ignora y se cobra el oficial", async () => {
    process.env.PRECIO_PRUEBA_HASTA = enHoras(100);
    await conPreferencia("individual");
    assert.equal(h.mp.preferencias[0].items[0].unit_price, 11990);
  });
});

describe("Meta: Purchase solo con el pago validado, una vez por compra", () => {

  const compras = () => h.metaEventos.filter(e => e.event_name === "Purchase");

  test("pago aprobado y validado: un Purchase con event_id purchase_<id> e importe cobrado, aunque el webhook se repita", async () => {
    const { id } = await conPreferencia("pareja");
    assert.deepEqual(h.metaEventos.map(e => [e.event_name, e.event_id]), [["InitiateCheckout", `checkout_${id}`]]);

    h.pagoAprobado("4001", id, { monto: 14990 });
    await Promise.all([h.webhook("4001"), h.webhook("4001")]);
    await h.webhook("4001");

    assert.equal(compras().length, 1);
    assert.equal(compras()[0].event_id, `purchase_${id}`);
    assert.equal(compras()[0].custom_data.value, 14990);
    assert.equal(compras()[0].custom_data.currency, "ARS");
  });

  test("pagos pendientes, rechazados o que no coinciden no generan Purchase", async () => {
    const { id } = await conPreferencia();
    h.pagoAprobado("4101", id, { monto: 11990, status: "pending" });
    h.pagoAprobado("4102", id, { monto: 11990, status: "rejected" });
    h.pagoAprobado("4103", id, { monto: 100 });
    h.pagoAprobado("4104", id, { monto: 11990, moneda: "USD" });
    for (const p of ["4101", "4102", "4103", "4104"]) await h.webhook(p);

    assert.equal((await estado(id)).pagado, false);
    assert.equal(compras().length, 0);

    // segundo pago aprobado de un recuerdo ya pago: revisión, sin otra compra
    h.pagoAprobado("4105", id, { monto: 11990 });
    h.pagoAprobado("4106", id, { monto: 11990 });
    await h.webhook("4105");
    await h.webhook("4106");
    assert.equal(compras().length, 1);
  });

  test("GET /api/recuerdo/:id informa la compra (importe cobrado) solo durante 24 h", async () => {
    const { id } = await conPreferencia("pareja");
    assert.equal((await (await api(`/api/recuerdo/${id}`)).json()).compra, undefined);

    h.pagoAprobado("4201", id, { monto: 14990 });
    await h.webhook("4201");
    assert.deepEqual((await (await api(`/api/recuerdo/${id}`)).json()).compra, { valor: 14990, moneda: "ARS" });

    // una compra vieja: la página de éxito ya no registra Purchase
    await prisma.recuerdo.update({ where: { id }, data: { pagadoEn: new Date(Date.now() - 25 * 3600 * 1000) } });
    const viejo = await (await api(`/api/recuerdo/${id}`)).json();
    assert.equal(viejo.pagado, true);
    assert.equal(viejo.compra, undefined);
  });

  test("la preferencia guarda solo cookies de Meta con formato válido", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token, { pack: "individual" });
    const res = await api("/api/crear-preferencia", {
      method: "POST", token,
      json: { recuerdoId: data.id, fbp: "fb.1.1760000000000.123456789", fbc: "<script>" }
    });
    assert.equal(res.status, 200);
    const meta = h.mp.preferencias[0].metadata;
    assert.equal(meta.meta_fbp, "fb.1.1760000000000.123456789");
    assert.equal(meta.meta_fbc, undefined);
  });
});
