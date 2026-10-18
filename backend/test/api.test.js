const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const h = require("./helpers");
const { api, prisma } = h;

const archivosCreados = [];
const archivosEventos = [];
const recuerdosBorrados = [];
let eventosBase;

before(async () => {
  await h.iniciar();
  eventosBase = await h.iniciarConEventos();
});

after(async () => {
  h.borrarArchivosSubidos(archivosCreados);
  h.borrarApartados(recuerdosBorrados);
  for (const f of archivosEventos) if (fs.existsSync(f)) fs.unlinkSync(f);
  await h.detener();
});

beforeEach(async () => {
  await h.limpiarBase();
});

const subirRecuerdo = h.crearSubidor(archivosCreados);

async function crearKeychain(pack = "individual") {
  const admin = await h.loginAdmin();
  const ruta = pack === "pareja" ? "/api/keychain-admin/generar-pareja" : "/api/keychain-admin/generar-individuales";
  const res = await api(ruta, { method: "POST", token: admin, json: { cantidad: 1 } });
  assert.equal(res.status, 200);
  await api("/api/keychain-admin/limpiar", { method: "POST", token: admin });
  const k = await prisma.keychain.findFirst({ where: { pack }, orderBy: { createdAt: "desc" } });
  return k.qrId;
}

/* ====================================================== */
describe("PostgreSQL y migraciones", () => {

  test("la conexión responde y /api/health informa la base", async () => {
    const res = await api("/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, db: "postgresql" });
  });

  test("todas las migraciones del repo están aplicadas y existen las tablas esperadas", async () => {
    const dir = path.join(h.ROOT, "prisma/migrations");
    const enDisco = fs.readdirSync(dir).filter(d => fs.statSync(path.join(dir, d)).isDirectory());
    const migraciones = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    assert.ok(migraciones.length >= 1);
    assert.deepEqual(migraciones.map(m => m.migration_name).sort(), enDisco.sort());
    for (const m of migraciones) {
      assert.ok(m.finished_at && !m.rolled_back_at, `${m.migration_name} terminó`);
    }

    const tablas = (await prisma.$queryRaw`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'`).map(t => t.table_name);
    for (const t of ["users", "recuerdos", "recuerdo_audios", "keychains", "events", "event_qrs", "pagos_revision"]) {
      assert.ok(tablas.includes(t), `falta la tabla ${t}`);
    }
  });

  test("las restricciones SQL propias de todas las migraciones siguen presentes", async () => {
    const checks = (await prisma.$queryRaw`
      SELECT conname FROM pg_constraint WHERE contype = 'c'`).map(c => c.conname);
    for (const c of [
      "users_email_lowercase_chk", "recuerdos_nombre_chk", "recuerdo_audios_orden_chk",
      "keychains_escaneos_chk", "keychains_vinculo_chk", "recuerdos_monto_esperado_chk",
      "recuerdos_moneda_chk", "recuerdos_monto_pagado_chk", "recuerdos_email_pago_chk"
    ]) {
      assert.ok(checks.includes(c), `falta ${c}`);
    }
  });

  test("la base arranca sin datos comerciales", async () => {
    // beforeEach vacía la base; este test confirma que no hay seed que reinserte datos
    for (const modelo of ["user", "recuerdo", "keychain", "event", "eventQr", "pagoRevision"]) {
      assert.equal(await prisma[modelo].count(), 0, modelo);
    }
  });
});

/* ====================================================== */
describe("Login con Google y autenticación", () => {

  test("crea el usuario una sola vez y devuelve token + email", async () => {
    const t1 = await h.login("ana@example.com", { picture: "https://foto" });
    const t2 = await h.login("ana@example.com");
    assert.ok(t1 && t2);
    const users = await prisma.user.findMany();
    assert.equal(users.length, 1);
    assert.equal(users[0].googleId, "sub-ana@example.com");
    assert.equal(users[0].picture, "https://foto");
  });

  test("normaliza el email a minúsculas", async () => {
    await h.login("Ana@Example.COM");
    const user = await prisma.user.findFirst();
    assert.equal(user.email, "ana@example.com");
  });

  test("sin credential → 400; credential inválida → 401 (el frontend solo mira data.token)", async () => {
    let res = await api("/api/auth/google", { method: "POST", json: {} });
    assert.equal(res.status, 400);
    res = await api("/api/auth/google", { method: "POST", json: { credential: "invalido" } });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).token, undefined);
  });

  test("rutas privadas: sin token 401, token adulterado 401, usuario inexistente 401", async () => {
    let res = await api("/api/mis-recuerdos");
    assert.equal(res.status, 401);
    res = await api("/api/mis-recuerdos", { token: "no.es.jwt" });
    assert.equal(res.status, 401);
    res = await api("/api/mis-recuerdos", { token: h.tokenPara("fantasma@example.com") });
    assert.equal(res.status, 401);
  });

  test("subir recuerdo sin sesión → 401", async () => {
    const { res } = await subirRecuerdo(undefined);
    assert.equal(res.status, 401);
  });
});

/* ====================================================== */
describe("Recuerdos: creación, pago y consulta", () => {

  test("flujo completo individual: upload → preferencia → webhook → recuerdo visible", async () => {
    const token = await h.login("ana@example.com");

    const { res, data } = await subirRecuerdo(token, { nombre: "  Abuela  " });
    assert.equal(res.status, 200);
    assert.match(data.id, /^[0-9a-f-]{36}$/);

    // archivos en disco, referencias en la base
    const r = await prisma.recuerdo.findUnique({ where: { id: data.id }, include: { audios: true } });
    assert.equal(r.nombre, "Abuela");
    assert.equal(r.pagado, false);
    assert.equal(r.audios.length, 1);
    assert.ok(fs.existsSync(path.join(h.ROOT, "uploads/audio", path.basename(r.audios[0].url))));
    assert.ok(fs.existsSync(path.join(h.ROOT, "uploads/qr", `${data.id}.png`)));
    assert.equal(h.contarArchivos("temp"), 0, "temp limpio");

    // antes del pago
    let pub = await (await api(`/api/recuerdo/${data.id}`)).json();
    assert.deepEqual(pub, { pagado: false, pack: "individual" });

    // preferencia de Mercado Pago (simulada)
    let pref = await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: data.id } });
    assert.equal(pref.status, 200);
    assert.deepEqual(await pref.json(), { id: "pref-1", init_point: "https://mp.test/checkout" });
    const body = h.mp.preferencias[0];
    assert.equal(body.external_reference, `REQRDITO_${data.id}`);
    assert.equal(body.items[0].unit_price, 11990);
    assert.equal(body.items[0].currency_id, "ARS");
    assert.equal(body.notification_url, "https://api.reqrdito.com/api/webhook");
    assert.deepEqual(body.back_urls, {
      success: "https://www.reqrdito.com/pago-exito.html",
      failure: "https://www.reqrdito.com/error.html",
      pending: "https://www.reqrdito.com/pago-pendiente.html"
    });

    // webhook aprobado
    h.pagoAprobado("999", data.id, { monto: 11990 });
    let wh = await h.webhook("999");
    assert.equal(wh.status, 200);

    const pagado = await prisma.recuerdo.findUnique({ where: { id: data.id } });
    assert.equal(pagado.pagado, true);
    assert.equal(pagado.paymentId, "999");
    assert.equal(pagado.payerEmail, "pagador@example.com");
    assert.ok(pagado.pagadoEn);
    assert.equal(Number(pagado.montoPagado), 11990);
    assert.ok(pagado.emailPagoEnviadoEn, "email marcado como enviado");
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0].to, "ana@example.com");
    assert.equal(h.emails[0].variables.CODIGO, data.id);

    // webhook duplicado: no reenvía mail
    wh = await h.webhook("999");
    assert.equal(wh.status, 200);
    assert.equal(h.emails.length, 1);

    // ya pago: no se puede generar otra preferencia
    pref = await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: data.id } });
    assert.equal(pref.status, 409);

    // contrato público usado por recuerdo.html
    pub = await (await api(`/api/recuerdo/${data.id}`)).json();
    assert.equal(pub.pagado, true);
    assert.equal(pub.recuerdoId, data.id);
    assert.equal(pub.nombre, "Abuela");
    assert.equal(pub.pack, "individual");
    assert.equal(pub.qrUrl, `/qr/${data.id}.png`);
    assert.ok(pub.creadoEn);
    assert.deepEqual(Object.keys(pub.audios[0]).sort(), ["orden", "url"]);
    for (const privado of ["payerEmail", "paymentId", "userId", "montoPagado"]) {
      assert.ok(!(privado in pub), `no expone ${privado}`);
    }

    // el audio se sirve como archivo estático
    const audio = await api(pub.audios[0].url);
    assert.equal(audio.status, 200);
  });

  test("webhook: pago no aprobado, referencia ajena o recuerdo inexistente no marcan pago", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);

    h.pagoAprobado("1", data.id, { monto: 11990, status: "pending" });
    h.mp.pagos.set("2", { status: "approved", external_reference: "OTRA_COSA", transaction_amount: 11990, currency_id: "ARS" });
    h.mp.pagos.set("3", { status: "approved", external_reference: "REQRDITO_no-es-uuid", transaction_amount: 11990, currency_id: "ARS" });
    h.pagoAprobado("4", "7d9f0c1e-1111-4222-8333-444455556666", { monto: 11990 });
    h.pagoAprobado("5", data.id, { monto: 11990, status: "rejected" });
    h.pagoAprobado("6", data.id, { monto: 11990, status: "cancelled" });
    h.pagoAprobado("7", data.id, { monto: 11990, status: "in_process" });

    for (const id of ["1", "2", "3", "4", "5", "6", "7"]) {
      const res = await h.webhook(id);
      assert.equal(res.status, 200, `pago ${id}`);
    }
    // sin data.id → 200 sin hacer nada
    assert.equal((await api("/api/webhook", { method: "POST", json: {} })).status, 200);

    const r = await prisma.recuerdo.findUnique({ where: { id: data.id } });
    assert.equal(r.pagado, false);
    assert.equal(h.emails.length, 0);

    // referencia inválida o recuerdo inexistente quedan para revisión
    const revision = await prisma.pagoRevision.findMany({ orderBy: { paymentId: "asc" } });
    assert.deepEqual(revision.map(p => [p.paymentId, p.motivo]), [["3", "referencia_invalida"], ["4", "recuerdo_inexistente"]]);
  });

  test("webhook: si Mercado Pago falla responde 500 para que reintente", async () => {
    const res = await h.webhook("123456");
    assert.equal(res.status, 500);
    // ids que no son de Mercado Pago no llegan a consultarse
    const consultas = h.mp.consultas;
    assert.equal((await h.webhook("../../x")).status, 200);
    assert.equal(h.mp.consultas, consultas);
  });

  test("pack pareja (Dúo): exige dos audios y los guarda ordenados", async () => {
    const token = await h.login("ana@example.com");

    let { res } = await subirRecuerdo(token, { pack: "pareja" });
    assert.equal(res.status, 400);

    const ok = await subirRecuerdo(token, { pack: "pareja", dosAudios: true });
    assert.equal(ok.res.status, 200);

    const r = await prisma.recuerdo.findUnique({ where: { id: ok.data.id }, include: { audios: true } });
    assert.equal(r.pack, "pareja");
    assert.deepEqual(r.audios.map(a => a.orden).sort(), [1, 2]);

    await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: ok.data.id } });
    assert.equal(h.mp.preferencias[0].items[0].unit_price, 14990);
    assert.equal(h.mp.preferencias[0].items[0].title, "Recuerdo QR – Dúo");
  });

  test("validación de entradas del upload", async () => {
    const token = await h.login("ana@example.com");
    assert.equal((await subirRecuerdo(token, { nombre: null })).res.status, 400);
    assert.equal((await subirRecuerdo(token, { nombre: "   " })).res.status, 400);
    assert.equal((await subirRecuerdo(token, { nombre: "x".repeat(121) })).res.status, 400);
    assert.equal((await subirRecuerdo(token, { pack: "trio" })).res.status, 400);
    assert.equal(await prisma.recuerdo.count(), 0);
    assert.equal(h.contarArchivos("temp"), 0, "temp limpio tras rechazos");
  });

  test("ids inválidos o inexistentes → 404 (no 500)", async () => {
    const token = await h.login("ana@example.com");
    assert.equal((await api("/api/recuerdo/abc")).status, 404);
    assert.equal((await api("/api/recuerdo/7d9f0c1e-1111-4222-8333-444455556666")).status, 404);
    assert.equal((await api("/api/crear-preferencia", { method: "POST", token, json: { recuerdoId: "abc" } })).status, 404);
    assert.equal((await api("/api/crear-preferencia", { method: "POST", token, json: {} })).status, 400);
    assert.equal((await api("/api/descargar-qr/abc")).status, 404);
  });

  test("descargar QR del recuerdo", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);
    const res = await api(`/api/descargar-qr/${data.id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition"), /recuerdo-.*\.png/);
  });
});

/* ====================================================== */
describe("Mis recuerdos: titularidad y permisos", () => {

  async function recuerdoPagado(token) {
    const { data } = await subirRecuerdo(token);
    await prisma.recuerdo.update({ where: { id: data.id }, data: { pagado: true } });
    return data.id;
  }

  test("lista solo recuerdos pagados del usuario, más nuevos primero, con el formato del frontend", async () => {
    const ana = await h.login("ana@example.com");
    const beto = await h.login("beto@example.com");

    const id1 = await recuerdoPagado(ana);
    const id2 = await recuerdoPagado(ana);
    await subirRecuerdo(ana); // sin pagar: no aparece
    await recuerdoPagado(beto);

    const lista = await (await api("/api/mis-recuerdos", { token: ana })).json();
    assert.deepEqual(lista.map(r => r.recuerdoId), [id2, id1]);
    for (const r of lista) {
      for (const campo of ["_id", "recuerdoId", "nombre", "pack", "audios", "qrUrl", "creadoEn"]) {
        assert.ok(campo in r, `falta ${campo}`);
      }
    }
  });

  test("editar nombre: dueño OK, otro usuario 403, nombre inválido 400", async () => {
    const ana = await h.login("ana@example.com");
    const beto = await h.login("beto@example.com");
    const id = await recuerdoPagado(ana);

    let res = await api(`/api/recuerdos/${id}`, { method: "PUT", token: beto, json: { nombre: "Hackeado" } });
    assert.equal(res.status, 403);
    res = await api(`/api/recuerdos/${id}`, { method: "PUT", token: ana, json: { nombre: "a" } });
    assert.equal(res.status, 400);
    res = await api(`/api/recuerdos/${id}`, { method: "PUT", token: ana, json: { nombre: " Mamá " } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, nombre: "Mamá" });
  });

  test("reenviar mail: dueño OK, otro usuario 403, impago 409", async () => {
    const ana = await h.login("ana@example.com");
    const beto = await h.login("beto@example.com");
    const id = await recuerdoPagado(ana);
    const { data: impago } = await subirRecuerdo(ana);

    assert.equal((await api(`/api/recuerdos/${id}/reenviar-mail`, { method: "POST", token: beto })).status, 403);
    assert.equal((await api(`/api/recuerdos/${impago.id}/reenviar-mail`, { method: "POST", token: ana })).status, 409);
    assert.equal((await api(`/api/recuerdos/${id}/reenviar-mail`, { method: "POST", token: ana })).status, 200);
    assert.equal(h.emails.length, 1);
    assert.equal(h.emails[0].variables.LINK_RECUERDO, `https://www.reqrdito.com/recuerdo.html?id=${id}`);
  });

  test("eliminar: otro usuario 403, dueño borra recuerdo y audios; los archivos se apartan, no se borran", async () => {
    const ana = await h.login("ana@example.com");
    const beto = await h.login("beto@example.com");
    const id = await recuerdoPagado(ana);
    const otro = await recuerdoPagado(ana);
    recuerdosBorrados.push(id);
    const { audios } = await prisma.recuerdo.findUnique({ where: { id }, include: { audios: true } });
    const audioLocal = path.join(h.ROOT, "uploads/audio", path.basename(audios[0].url));

    assert.equal((await api(`/api/recuerdos/${id}`, { method: "DELETE", token: beto })).status, 403);
    assert.ok(fs.existsSync(audioLocal), "un intento ajeno no toca archivos");

    assert.equal((await api(`/api/recuerdos/${id}`, { method: "DELETE", token: ana })).status, 200);
    assert.equal(await prisma.recuerdo.count(), 1);
    assert.equal(await prisma.recuerdoAudio.count({ where: { recuerdoId: id } }), 0);

    // los archivos pasan a uploads/eliminados/<id>/; los del otro recuerdo siguen en su lugar
    assert.ok(!fs.existsSync(audioLocal));
    assert.ok(fs.existsSync(path.join(h.ROOT, "uploads/eliminados", id, path.basename(audioLocal))));
    assert.ok(fs.existsSync(path.join(h.ROOT, "uploads/eliminados", id, `${id}.png`)));
    assert.ok(fs.existsSync(path.join(h.ROOT, "uploads/qr", `${otro}.png`)));

    assert.equal((await api(`/api/recuerdos/${id}`, { method: "DELETE", token: ana })).status, 404);
  });
});

/* ====================================================== */
describe("Llaveros (QR físicos)", () => {

  test("activación completa: escaneo → activar → upload con key → redirección al recuerdo", async () => {
    const key = await crearKeychain("individual");
    assert.match(key, /^QR-[A-Z2-9]{8}$/);

    // primer escaneo: aún sin usar → activar.html
    let res = await api(`/api/keychain/r/${key}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `https://www.reqrdito.com/activar.html?key=${key}`);

    let act = await (await api(`/api/keychain/activar?key=${key}`)).json();
    assert.equal(act.success, true);
    assert.equal(act.usado, false);
    assert.equal(act.pack, "individual");

    const token = await h.login("ana@example.com");
    const { res: up, data } = await subirRecuerdo(token, { key, nombre: "Piki" });
    assert.equal(up.status, 200);

    const r = await prisma.recuerdo.findUnique({ where: { id: data.id } });
    assert.equal(r.pagado, true, "los llaveros vienen prepagos");

    act = await (await api(`/api/keychain/activar?key=${key}`)).json();
    assert.equal(act.usado, true);
    assert.equal(act.recuerdoId, data.id);
    assert.equal(act.nombreRecuerdo, "Piki");
    assert.match(act.audioUrl, /^\/audio\/.+\.mp3$/);

    // segundo escaneo → recuerdo.html
    res = await api(`/api/keychain/r/${key}`);
    assert.equal(res.headers.get("location"), `https://www.reqrdito.com/recuerdo.html?id=${data.id}`);

    const k = await (await api(`/api/keychain/${key}`)).json();
    assert.equal(k.escaneos, 2);
    for (const campo of ["_id", "qrId", "pack", "usado", "recuerdoId", "nombreRecuerdo", "audioUrl", "escaneos", "activadoEn", "creadoEn"]) {
      assert.ok(campo in k, `falta ${campo}`);
    }

    // no se puede reutilizar
    const otra = await subirRecuerdo(token, { key });
    assert.equal(otra.res.status, 403);
  });

  test("códigos históricos (KEY...) siguen funcionando", async () => {
    await prisma.keychain.create({ data: { qrId: "KEYAB12CD" } });
    const res = await api("/api/keychain/r/KEYAB12CD");
    assert.equal(res.headers.get("location"), "https://www.reqrdito.com/activar.html?key=KEYAB12CD");
  });

  test("llavero inexistente, pack incorrecto y cantidades inválidas", async () => {
    const token = await h.login("ana@example.com");
    assert.equal((await subirRecuerdo(token, { key: "QR-NOEXISTE" })).res.status, 400);
    assert.equal((await subirRecuerdo(token, { key: "../../etc" })).res.status, 400);

    const key = await crearKeychain("individual");
    assert.equal((await subirRecuerdo(token, { key, pack: "pareja", dosAudios: true })).res.status, 403);

    assert.equal((await api("/api/keychain/activar")).status, 400);
    assert.equal((await api("/api/keychain/activar?key=QR-NOEXISTE")).status, 404);
    assert.equal((await api("/api/keychain/QR-NOEXISTE")).status, 404);
    assert.equal((await api("/api/keychain/r/QR-NOEXISTE")).status, 404);

    const admin = await h.loginAdmin();
    for (const cantidad of [0, -1, "abc", 1.5, 501]) {
      const res = await api("/api/keychain-admin/generar-individuales", { method: "POST", token: admin, json: { cantidad } });
      assert.equal(res.status, 400, `cantidad ${cantidad}`);
    }
    assert.equal(h.contarArchivos("temp"), 0);
  });

  test("generar PDF de llaveros acumulados (tanda persistida en la base, sin archivo temporal)", async () => {
    const admin = await h.loginAdmin();
    const pdfPath = path.join(h.ROOT, "qrs.pdf");
    const pdfPrevio = fs.existsSync(pdfPath);

    await api("/api/keychain-admin/limpiar", { method: "POST", token: admin });
    assert.equal((await api("/api/keychain-admin/generar-pdf", { token: admin })).status, 400);
    const res = await api("/api/keychain-admin/generar-pareja", { method: "POST", token: admin, json: { cantidad: 2 } });
    assert.deepEqual(await res.json(), { total: 2 });
    // más de una página A4 (25 por página)
    await api("/api/keychain-admin/generar-individuales", { method: "POST", token: admin, json: { cantidad: 26 } });

    const tanda = await (await api("/api/keychain-admin/tanda", { token: admin })).json();
    assert.equal(tanda.total, 28);

    // dos PDF simultáneos no se pisan
    const [a, b] = await Promise.all([
      api("/api/keychain-admin/generar-pdf", { token: admin }),
      api("/api/keychain-admin/generar-pdf", { token: admin })
    ]);
    for (const pdf of [a, b]) {
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers.get("content-type"), "application/pdf");
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
    }
    assert.equal(fs.existsSync(pdfPath), pdfPrevio, "no se escribe qrs.pdf");

    // limpiar saca de la tanda pero no borra llaveros
    const limpiar = await (await api("/api/keychain-admin/limpiar", { method: "POST", token: admin })).json();
    assert.equal(limpiar.quitados, 28);
    assert.equal(await prisma.keychain.count(), 28);
    assert.equal((await (await api("/api/keychain-admin/tanda", { token: admin })).json()).total, 0);
  });

  test("borrar el recuerdo libera la FK pero el llavero sigue marcado como usado", async () => {
    const key = await crearKeychain("individual");
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token, { key });
    recuerdosBorrados.push(data.id);

    assert.equal((await api(`/api/recuerdos/${data.id}`, { method: "DELETE", token })).status, 200);

    const k = await prisma.keychain.findUnique({ where: { qrId: key } });
    assert.equal(k.recuerdoId, null);
    assert.equal(k.usado, true);

    // el escaneo ya no redirige a un recuerdo inexistente, y no puede reactivarse
    const res = await api(`/api/keychain/r/${key}`);
    assert.equal(res.headers.get("location"), "https://www.reqrdito.com/");
    assert.equal((await subirRecuerdo(token, { key })).res.status, 403);
  });

  test("activación concurrente: el mismo llavero no se usa dos veces y no quedan archivos huérfanos", async () => {
    const key = await crearKeychain("individual");
    const ana = await h.login("ana@example.com");
    const beto = await h.login("beto@example.com");
    const audiosAntes = h.contarArchivos("audio");
    const qrAntes = h.contarArchivos("qr");

    const resultados = await Promise.all([
      subirRecuerdo(ana, { key }), subirRecuerdo(beto, { key }), subirRecuerdo(ana, { key })
    ]);
    const estados = resultados.map(r => r.res.status).sort();
    assert.deepEqual(estados, [200, 403, 403]);

    assert.equal(await prisma.recuerdo.count(), 1);
    const k = await prisma.keychain.findUnique({ where: { qrId: key } });
    assert.equal(k.usado, true);
    assert.equal(k.recuerdoId, resultados.find(r => r.res.status === 200).data.id);

    // solo quedan los archivos del recuerdo creado
    assert.equal(h.contarArchivos("audio"), audiosAntes + 1);
    assert.equal(h.contarArchivos("qr"), qrAntes + 1);
    assert.equal(h.contarArchivos("temp"), 0);
  });
});

/* ====================================================== */
describe("Módulo de eventos deshabilitado (configuración por defecto)", () => {

  test("rutas, panel y archivos estáticos de eventos responden 503; los datos se conservan", async () => {
    // datos de eventos existentes (tablas conservadas)
    const u = await prisma.user.create({ data: { email: "cliente@example.com" } });
    const e = await prisma.event.create({ data: { name: "Casamiento", userId: u.id } });
    const qr = await prisma.eventQr.create({
      data: { qrId: "9d9f0c1e-1111-4222-8333-444455556666", eventId: e.id, name: "Tía", audioUrl: "https://api.reqrdito.com/events/audio/x.mp3", status: "completed" }
    });

    for (const ruta of ["/events/list", `/events/r/${qr.qrId}`, `/events/qr-data/${qr.qrId}`, "/events-admin/login.html", "/events-admin/dashboard.html", "/events-public/style.css", "/events/audio/x.mp3"]) {
      const res = await api(ruta);
      assert.equal(res.status, 503, ruta);
    }
    const crear = await api("/events/create", { method: "POST", json: { name: "x", emailCliente: "a@b.c" } });
    assert.equal(crear.status, 503);

    // los QR de eventos no aparecen ni se pueden borrar desde Mis recuerdos
    const token = await h.login("cliente@example.com");
    const mis = await (await api("/api/mis-recuerdos", { token })).json();
    assert.deepEqual(mis, []);
    assert.equal((await api(`/api/recuerdos/${qr.qrId}`, { method: "DELETE", token })).status, 404);

    assert.equal(await prisma.event.count(), 1);
    assert.equal(await prisma.eventQr.count(), 1);
  });

  test("el resto del sistema sigue funcionando con eventos deshabilitado", async () => {
    assert.equal((await api("/api/health")).status, 200);
    assert.equal((await api("/api/precios")).status, 200);
    const token = await h.login("ana@example.com");
    const { res } = await subirRecuerdo(token);
    assert.equal(res.status, 200);
  });
});

/* ====================================================== */
describe("Eventos (módulo conservado, probado en una instancia con EVENTS_ENABLED=true)", () => {

  // admin: endpoints del panel; público: lo que usan los invitados
  let admin;
  beforeEach(async () => { admin = await h.loginAdmin(eventosBase); });
  const evApi = (ruta, opciones = {}) => api(ruta, { base: eventosBase, ...opciones });
  const adm = (ruta, opciones = {}) => evApi(ruta, { token: admin, ...opciones });

  async function crearEvento(email = "cliente@example.com") {
    const res = await adm("/events/create", { method: "POST", json: { name: "Casamiento", emailCliente: email } });
    assert.equal(res.status, 200);
    return res.json();
  }

  test("el panel de eventos exige un administrador", async () => {
    const comun = await h.login("ana@example.com", {}, eventosBase);
    assert.equal((await evApi("/events/list")).status, 401);
    assert.equal((await evApi("/events/list", { token: comun })).status, 403);
    assert.equal((await evApi("/events/create", { method: "POST", token: comun, json: { name: "x", emailCliente: "a@b.c" } })).status, 403);
    assert.equal((await adm("/events/list")).status, 200);
  });

  test("crear evento da de alta al cliente y mantiene el formato con _id", async () => {
    const ev = await crearEvento("Cliente@Example.com");
    assert.ok(ev._id && ev._id === ev.id);
    assert.equal(ev.name, "Casamiento");
    assert.ok(ev.date);

    const cliente = await prisma.user.findUnique({ where: { email: "cliente@example.com" } });
    assert.equal(ev.userId, cliente.id);
    assert.equal(cliente.googleId, null);

    // cuando el cliente inicia sesión con Google se reutiliza el mismo usuario
    await h.login("cliente@example.com", {}, eventosBase);
    assert.equal(await prisma.user.count({ where: { email: "cliente@example.com" } }), 1);
    assert.equal((await prisma.user.findUnique({ where: { email: "cliente@example.com" } })).googleId, "sub-cliente@example.com");

    const lista = await (await adm("/events/list")).json();
    assert.equal(lista.length, 1);
    assert.equal((await (await adm(`/events/${ev._id}`)).json()).name, "Casamiento");
    assert.equal((await adm("/events/abc")).status, 404);
    assert.equal((await adm("/events/create", { method: "POST", json: { name: "x" } })).status, 400);
  });

  test("QRs del evento: generar, grabar audio, consultar, redirigir y verlos en Mis recuerdos", async () => {
    const ev = await crearEvento();

    const gen = await adm(`/events/${ev._id}/generate-qrs`, { method: "POST", json: { cantidad: 2 } });
    const qrs = await gen.json();
    assert.equal(qrs.length, 2);
    assert.match(qrs[0].qrImg, /^data:image\/png;base64,/);
    assert.equal((await adm(`/events/${ev._id}/generate-qrs`, { method: "POST", json: { cantidad: 0 } })).status, 400);

    const qrId = qrs[0].qrId;

    // audio mp3: no requiere ffmpeg (los invitados no inician sesión)
    const form = new FormData();
    form.append("name", "Tía Marta");
    form.append("audio", new Blob([Buffer.from("mp3")], { type: "audio/mpeg" }), "saludo.mp3");
    const up = await evApi(`/events/qr/${qrId}/audio`, { method: "POST", form });
    assert.equal(up.status, 200);

    const lista = await (await adm(`/events/${ev._id}/qrs`)).json();
    const grabado = lista.find(q => q.qrId === qrId);
    assert.equal(grabado.status, "completed");
    assert.equal(grabado.name, "Tía Marta");
    assert.equal(grabado.userEmail, "cliente@example.com");
    assert.match(grabado.audioUrl, /^https:\/\/api\.reqrdito\.com\/events\/audio\/.+\.mp3$/);
    archivosEventos.push(path.join(h.ROOT, "events/uploads", path.basename(grabado.audioUrl)));

    const datos = await (await evApi(`/events/qr-data/${qrId}`)).json();
    assert.deepEqual(datos, { name: "Tía Marta", file: grabado.audioUrl, status: "completed" });

    const redir = await evApi(`/events/r/${qrId}`);
    assert.equal(redir.status, 302);
    assert.equal(redir.headers.get("location"), `https://www.reqrdito.com/recuerdo-evento.html?qr=${qrId}`);

    const audio = await evApi(`/events/audio/${path.basename(grabado.audioUrl)}`);
    assert.equal(audio.headers.get("content-type"), "audio/mpeg");

    // el cliente ve solo los QR grabados, como pack "evento"
    const token = await h.login("cliente@example.com", {}, eventosBase);
    const mis = await (await evApi("/api/mis-recuerdos", { token })).json();
    assert.equal(mis.length, 1);
    assert.equal(mis[0].pack, "evento");
    assert.equal(mis[0].recuerdoId, qrId);
    assert.equal(mis[0].nombre, "Tía Marta");

    // otro usuario no puede borrar el QR del evento; el dueño sí
    const intruso = await h.login("intruso@example.com", {}, eventosBase);
    assert.equal((await evApi(`/api/recuerdos/${qrId}`, { method: "DELETE", token: intruso })).status, 403);
    assert.equal((await evApi(`/api/recuerdos/${qrId}`, { method: "DELETE", token })).status, 200);

    // borrar desde el panel
    const otro = qrs[1].qrId;
    assert.equal((await adm(`/events/qr/${otro}`, { method: "DELETE" })).status, 200);
    assert.equal((await adm(`/events/qr/${otro}`, { method: "DELETE" })).status, 404);
    assert.equal(await prisma.eventQr.count(), 0);
  });

  test("audio de evento: QR inexistente 404, archivo no permitido rechazado", async () => {
    const form = new FormData();
    form.append("audio", new Blob([Buffer.from("x")], { type: "audio/mpeg" }), "a.mp3");
    const res = await evApi("/events/qr/7d9f0c1e-1111-4222-8333-444455556666/audio", { method: "POST", form });
    assert.equal(res.status, 404);

    const ev = await crearEvento();
    const [{ qrId }] = await (await adm(`/events/${ev._id}/generate-qrs`, { method: "POST", json: { cantidad: 1 } })).json();
    const malo = new FormData();
    malo.append("audio", new Blob([Buffer.from("x")], { type: "text/plain" }), "a.txt");
    const res2 = await evApi(`/events/qr/${qrId}/audio`, { method: "POST", form: malo });
    assert.equal(res2.status, 400);
    assert.deepEqual(await res2.json(), { error: "Archivo no válido" });
    assert.equal((await prisma.eventQr.findUnique({ where: { qrId } })).status, "empty");
  });

  test("borrar un evento borra sus QRs en cascada", async () => {
    const ev = await crearEvento();
    await adm(`/events/${ev._id}/generate-qrs`, { method: "POST", json: { cantidad: 3 } });
    await prisma.event.delete({ where: { id: ev._id } });
    assert.equal(await prisma.eventQr.count(), 0);
  });
});

/* ====================================================== */
describe("Integridad referencial y restricciones", () => {

  const UUID = "7d9f0c1e-1111-4222-8333-444455556666";

  async function rechaza(promesa, patron) {
    await assert.rejects(promesa, err => patron.test(err.message) || patron.test(String(err.code)));
  }

  test("un recuerdo exige un usuario existente", async () => {
    await rechaza(
      prisma.recuerdo.create({ data: { id: UUID, userId: UUID, nombre: "x" } }),
      /foreign key|P2003/i
    );
  });

  test("no se puede borrar un usuario que tiene recuerdos", async () => {
    const u = await prisma.user.create({ data: { email: "a@example.com" } });
    await prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x" } });
    await rechaza(prisma.user.delete({ where: { id: u.id } }), /foreign key|P2003|P2014/i);
  });

  test("CHECKs: email en minúsculas, orden de audio 1-2, nombre no vacío, vínculo de llavero", async () => {
    await rechaza(prisma.$executeRawUnsafe(`INSERT INTO users (id, email, updated_at) VALUES (gen_random_uuid(), 'Mayus@Example.com', now())`), /users_email_lowercase_chk/);

    const u = await prisma.user.create({ data: { email: "a@example.com" } });
    await rechaza(prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "   " } }), /recuerdos_nombre_chk|constraint/i);

    await prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x" } });
    await rechaza(prisma.recuerdoAudio.create({ data: { recuerdoId: UUID, url: "/audio/a.mp3", orden: 3 } }), /recuerdo_audios_orden_chk|constraint/i);

    await prisma.recuerdoAudio.create({ data: { recuerdoId: UUID, url: "/audio/a.mp3", orden: 1 } });
    await rechaza(prisma.recuerdoAudio.create({ data: { recuerdoId: UUID, url: "/audio/b.mp3", orden: 1 } }), /P2002|unique/i);

    await rechaza(prisma.keychain.create({ data: { qrId: "QR-X", recuerdoId: UUID, usado: false } }), /keychains_vinculo_chk|constraint/i);
    await rechaza(prisma.keychain.create({ data: { qrId: "QR-Y", escaneos: -1 } }), /keychains_escaneos_chk|constraint/i);
  });

  test("CHECKs de pagos: importe positivo, moneda ISO y email de pago solo en recuerdos pagados", async () => {
    const u = await prisma.user.create({ data: { email: "a@example.com" } });
    await rechaza(prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x", montoEsperado: 0 } }), /recuerdos_monto_esperado_chk|constraint/i);
    await rechaza(prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x", moneda: "ars" } }), /recuerdos_moneda_chk|constraint/i);
    await rechaza(prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x", emailPagoEnviadoEn: new Date() } }), /recuerdos_email_pago_chk|constraint/i);
  });

  test("un recuerdo solo puede vincularse a un llavero y un pago a un recuerdo", async () => {
    const u = await prisma.user.create({ data: { email: "a@example.com" } });
    await prisma.recuerdo.create({ data: { id: UUID, userId: u.id, nombre: "x", paymentId: "77" } });
    await prisma.keychain.create({ data: { qrId: "QR-A", recuerdoId: UUID, usado: true } });
    await rechaza(prisma.keychain.create({ data: { qrId: "QR-B", recuerdoId: UUID, usado: true } }), /P2002|unique/i);
    await rechaza(
      prisma.recuerdo.create({ data: { id: "8d9f0c1e-1111-4222-8333-444455556666", userId: u.id, nombre: "y", paymentId: "77" } }),
      /P2002|unique/i
    );
  });
});

describe("Personalización: foto, mensaje, fecha con contador y canción", () => {

  async function pagar(id) {
    await prisma.recuerdo.update({ where: { id }, data: { pagado: true } });
    return (await api(`/api/recuerdo/${id}`)).json();
  }

  test("se guarda todo lo opcional y la página pública lo devuelve", async () => {
    const token = await h.login("ana@example.com");
    const { res, data } = await subirRecuerdo(token, {
      foto: [h.fotoFalsa(), h.fotoFalsa("image/png"), h.fotoFalsa()],
      extra: {
        mensaje: "Feliz aniversario", fecha: "2023-03-15", fechaTitulo: "Juntos desde",
        cancion: "https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQC?si=x"
      }
    });
    assert.equal(res.status, 200);

    const pub = await pagar(data.id);
    assert.deepEqual(pub.fotos.map(f => f.orden), [1, 2, 3]);
    for (const f of pub.fotos) assert.match(f.url, /^\/foto\/[0-9a-f-]{36}\.jpg$/);
    assert.equal(pub.mensaje, "Feliz aniversario");
    assert.equal(pub.fecha, "2023-03-15");
    assert.equal(pub.fechaTitulo, "Juntos desde");
    assert.equal(pub.cancionUrl, "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    assert.equal((await api(pub.fotos[0].url)).status, 200);
  });

  test("hasta 4 fotos: una quinta se rechaza sin crear nada", async () => {
    const token = await h.login("ana@example.com");
    const cuatro = await subirRecuerdo(token, { foto: Array.from({ length: 4 }, () => h.fotoFalsa()) });
    assert.equal(cuatro.res.status, 200);
    assert.equal((await pagar(cuatro.data.id)).fotos.length, 4);

    const cinco = await subirRecuerdo(token, { foto: Array.from({ length: 5 }, () => h.fotoFalsa()) });
    assert.equal(cinco.res.status, 400);
    assert.equal(await prisma.recuerdo.count(), 1);
  });

  test("borrar el recuerdo aparta también sus fotos", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token, { foto: [h.fotoFalsa(), h.fotoFalsa()] });
    recuerdosBorrados.push(data.id);
    const res = await api(`/api/recuerdos/${data.id}`, { method: "DELETE", token });
    assert.equal(res.status, 200);
    assert.equal(await prisma.recuerdoFoto.count(), 0);
    const apartados = path.join(h.ROOT, "uploads/eliminados", data.id);
    assert.equal(fs.readdirSync(apartados).filter(f => f.endsWith(".jpg")).length, 2);
  });

  test("sin personalización el recuerdo funciona como antes y no expone campos vacíos", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);
    const pub = await pagar(data.id);
    for (const campo of ["fotos", "mensaje", "fecha", "fechaTitulo", "cancionUrl"]) {
      assert.ok(!(campo in pub), campo);
    }
  });

  test("rechaza foto que no es imagen, canción ajena y fecha inválida sin crear nada", async () => {
    const token = await h.login("ana@example.com");
    const casos = [
      [{ foto: new Blob(["<svg></svg>"], { type: "image/jpeg" }) }, 422],
      [{ foto: new Blob(["hola"], { type: "text/plain" }) }, 400],
      [{ extra: { cancion: "https://evil.com/cancion" } }, 400],
      [{ extra: { fecha: "2023-02-30" } }, 400]
    ];
    for (const [opciones, status] of casos) {
      const { res } = await subirRecuerdo(token, opciones);
      assert.equal(res.status, status, JSON.stringify(Object.keys(opciones)));
    }
    assert.equal(await prisma.recuerdo.count(), 0);
  });
});
