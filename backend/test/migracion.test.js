// Importación histórica MongoDB → PostgreSQL con un export ficticio (Extended JSON).
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const h = require("./helpers");
const { prisma } = h;
const { reconciliar } = require("../scripts/migracion/reconciliar");

const R1 = "1d9f0c1e-1111-4222-8333-444455556661";
const R2 = "2d9f0c1e-1111-4222-8333-444455556662";
const R3 = "3d9f0c1e-1111-4222-8333-444455556663";
const SIN_DUENIO = "4d9f0c1e-1111-4222-8333-444455556664";
let dir;

function exportFicticio() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "reqrdito-export-"));
  const escribir = (n, docs) => fs.writeFileSync(path.join(d, `${n}.json`), JSON.stringify(docs));
  escribir("users", [
    { _id: { $oid: "u1" }, email: "Ana@Example.com", googleId: "g-ana", name: "Ana" },
    { _id: { $oid: "u2" }, email: "beto@example.com", googleId: "g-beto" },
    { _id: { $oid: "u3" } }
  ]);
  escribir("recuerdos", [
    // pagado, formato nuevo (audios[]), con archivo histórico real en disco
    { _id: { $oid: "r1" }, recuerdoId: R1, nombre: "Abuela", pack: "individual", pagado: true, payment_id: "555",
      audios: [{ url: "/audio/a4f40dcc-2f18-4af6-93d0-44371baa25ae.mp3", orden: 1 }],
      qrUrl: "/qr/a4f40dcc-2f18-4af6-93d0-44371baa25ae.png", userEmail: "ana@example.com",
      creadoEn: { $date: "2025-12-01T10:00:00.000Z" } },
    // formato viejo (audioUrl), impago, archivo faltante, dueño sin documento en users
    { _id: { $oid: "r2" }, recuerdoId: R2, nombre: "  ", pack: "pareja", pagado: false,
      audioUrl: "/audio/no-existe.mp3", userEmail: "carla@example.com", creadoEn: { $date: { $numberLong: "1735689600000" } } },
    // Dúo con dos audios
    { _id: { $oid: "r3" }, recuerdoId: R3, nombre: "Dúo", pack: "pareja", pagado: true,
      audios: [{ url: "/audio/b.mp3", orden: 2 }, { url: "/audio/a.mp3", orden: 1 }], userEmail: "beto@example.com" },
    { _id: { $oid: "r4" }, recuerdoId: SIN_DUENIO, nombre: "Huérfano", pagado: false },
    { _id: { $oid: "r5" }, recuerdoId: "REQRDITO-9A7KQ2", nombre: "id viejo", userEmail: "ana@example.com" },
    { _id: { $oid: "r6" }, recuerdoId: "5d9f0c1e-1111-4222-8333-444455556665", nombre: "pago repetido", pagado: true, payment_id: "555", userEmail: "ana@example.com" }
  ]);
  escribir("keychains", [
    { qrId: "KEYAAA111", pack: "individual", usado: true, recuerdoId: R1, escaneos: { $numberInt: "7" }, activadoEn: { $date: "2025-12-02T00:00:00Z" } },
    { qrId: "KEYBBB222", pack: "pareja", usado: false },
    { qrId: "KEYCCC333", pack: "individual", usado: false, recuerdoId: R3 },      // inconsistente
    { qrId: "KEYDDD444", pack: "individual", usado: true, recuerdoId: SIN_DUENIO }, // recuerdo no importado
    { qrId: "KEYEEE555", pack: "individual", usado: true, recuerdoId: R1 },        // R1 ya vinculado
    { qrId: "KEYFFF666", pack: "trio" },
    // la versión Mongo guardó el texto "null" en llaveros sin vincular: hoy redirigen a activar
    { qrId: "KEYGGG777", pack: "individual", usado: false, recuerdoId: "null", escaneos: 13, activadoEn: { $date: "2026-03-31T13:20:03Z" } }
  ]);
  return d;
}

before(async () => {
  await h.iniciar();
  dir = exportFicticio();
});
after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await h.detener();
});
beforeEach(async () => { await h.limpiarBase(); });

describe("Reconciliación histórica", () => {

  test("la simulación no escribe nada y reporta lo que haría", async () => {
    const inf = await reconciliar(prisma, { dir });
    assert.equal(inf.modo, "simulacion");
    for (const m of ["user", "recuerdo", "recuerdoAudio", "keychain"]) {
      assert.equal(await prisma[m].count(), 0, m);
    }
    assert.equal(inf.recuerdos.importados, 3);
    assert.equal(inf.keychains.importados, 3);
  });

  test("importa con reglas de mapeo seguras y es idempotente", async () => {
    const inf = await reconciliar(prisma, { dir, aplicar: true });

    // users: 2 del export + 1 creado desde el dueño del recuerdo (carla)
    assert.equal(inf.users.importados, 2);
    assert.equal(inf.users.errores.length, 1);
    assert.equal(inf.recuerdos.usuariosCreados, 1);
    assert.equal(await prisma.user.count(), 3);
    const ana = await prisma.user.findUnique({ where: { email: "ana@example.com" } });
    assert.equal(ana.googleId, "g-ana");

    // recuerdos
    assert.equal(inf.recuerdos.importados, 3);
    assert.deepEqual(inf.recuerdos.omitidos.map(o => o.motivo), ["sin_duenio"]);
    assert.deepEqual(inf.recuerdos.errores.map(e => e.motivo).sort(), ["payment_id_ya_usado", "recuerdoId_no_uuid"]);

    const r1 = await prisma.recuerdo.findUnique({ where: { id: R1 }, include: { audios: true } });
    assert.equal(r1.userId, ana.id);
    assert.equal(r1.pagado, true);
    assert.equal(r1.paymentId, "555");
    assert.equal(r1.montoEsperado, null, "no se aplica la tarifa nueva a históricos");
    assert.ok(r1.emailPagoEnviadoEn, "no se reenvían emails a clientes históricos");
    assert.equal(r1.createdAt.toISOString(), "2025-12-01T10:00:00.000Z");
    assert.deepEqual(r1.audios.map(a => a.url), ["/audio/a4f40dcc-2f18-4af6-93d0-44371baa25ae.mp3"]);

    const r2 = await prisma.recuerdo.findUnique({ where: { id: R2 }, include: { audios: true, user: true } });
    assert.equal(r2.nombre, "Recuerdo");
    assert.equal(r2.pagado, false);
    assert.equal(r2.user.email, "carla@example.com");
    assert.equal(r2.audios[0].url, "/audio/no-existe.mp3");
    assert.equal(r2.createdAt.toISOString(), "2025-01-01T00:00:00.000Z");
    const avisosR2 = inf.recuerdos.avisos.find(a => a.id === R2).avisos;
    assert.ok(avisosR2.includes("nombre_vacio"));
    assert.ok(avisosR2.includes("audio_faltante:no-existe.mp3"));

    const r3 = await prisma.recuerdo.findUnique({ where: { id: R3 }, include: { audios: true } });
    assert.deepEqual(r3.audios.sort((a, b) => a.orden - b.orden).map(a => a.url), ["/audio/a.mp3", "/audio/b.mp3"]);

    // keychains: válidos importados, inconsistentes reportados y NO importados
    assert.equal(inf.keychains.importados, 3);
    assert.deepEqual(inf.keychains.omitidos.map(o => o.motivo).sort(), [
      "pack_desconocido:trio", "recuerdo_inexistente", "recuerdo_ya_vinculado_a_otro_llavero", "vinculado_pero_no_usado"
    ]);
    const k = await prisma.keychain.findUnique({ where: { qrId: "KEYAAA111" } });
    assert.equal(k.recuerdoId, R1);
    assert.equal(k.escaneos, 7);
    assert.equal(k.pendienteImpresion, false, "los históricos no entran en la tanda a imprimir");

    // recuerdoId textual "null": se importa libre (sigue yendo a activar) y conserva su historial
    const libre = await prisma.keychain.findUnique({ where: { qrId: "KEYGGG777" } });
    assert.equal(libre.recuerdoId, null);
    assert.equal(libre.usado, false);
    assert.equal(libre.escaneos, 13);
    assert.deepEqual(inf.keychains.avisos, [{ qrId: "KEYGGG777", motivo: "recuerdoId_textual_tratado_como_sin_vinculo" }]);

    assert.deepEqual(inf.verificacion, {
      users: 3, recuerdos: 3, recuerdosPagados: 2, audios: 4, keychains: 3, keychainsVinculados: 1
    });

    // segunda corrida: todo existe, nada cambia
    const antes = await prisma.recuerdo.findUnique({ where: { id: R1 } });
    const otra = await reconciliar(prisma, { dir, aplicar: true });
    assert.equal(otra.recuerdos.importados, 0);
    assert.equal(otra.recuerdos.existentes, 3);
    assert.equal(otra.users.importados, 0);
    assert.equal(otra.keychains.importados, 0);
    assert.equal(otra.keychains.existentes, 3);
    assert.deepEqual(otra.verificacion, inf.verificacion);
    assert.deepEqual(await prisma.recuerdo.findUnique({ where: { id: R1 } }), antes);
  });

  test("nunca modifica registros que ya existen en PostgreSQL", async () => {
    const u = await prisma.user.create({ data: { email: "ana@example.com", name: "Nombre actual" } });
    await prisma.recuerdo.create({ data: { id: R1, userId: u.id, nombre: "Editado por el usuario", pagado: false } });

    await reconciliar(prisma, { dir, aplicar: true });

    const r1 = await prisma.recuerdo.findUnique({ where: { id: R1 } });
    assert.equal(r1.nombre, "Editado por el usuario");
    assert.equal(r1.pagado, false);
    assert.equal((await prisma.user.findUnique({ where: { email: "ana@example.com" } })).name, "Nombre actual");
  });

  test("el inventario de archivos cuenta data/recuerdos.json sin importarlo", async () => {
    const inf = await reconciliar(prisma, {});
    assert.equal(inf.archivos.registrosDataJson, 4);
    assert.deepEqual(inf.archivos.dataJsonEstados, { pendiente_pago: 4 });
    assert.equal(await prisma.recuerdo.count(), 0);
  });
});
