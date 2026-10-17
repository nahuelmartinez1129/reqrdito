// Reconciliación e importación de datos históricos (MongoDB → PostgreSQL).
//
//   node scripts/migracion/reconciliar.js
//       Inventario de solo lectura: archivos de uploads/ vs PostgreSQL vs data/recuerdos.json.
//   node scripts/migracion/reconciliar.js --dir <carpeta-export>
//       Simulación de importación desde un export de MongoDB (no escribe nada).
//   node scripts/migracion/reconciliar.js --dir <carpeta-export> --aplicar
//       Importa. Idempotente: lo que ya existe en PostgreSQL se omite, nunca se
//       actualiza ni se borra. Se puede correr varias veces.
//
// La carpeta de export debe tener users.json, recuerdos.json y keychains.json
// generados con:  mongoexport --uri "$MONGO_URI" --collection <c> --jsonArray --out <c>.json
// (formato Extended JSON: {"$oid"}, {"$date"} se interpretan).
//
// Reglas de mapeo (docs/DATOS_HISTORICOS.md):
// - users: por email normalizado. googleId solo si no lo usa otro usuario.
// - recuerdos: id = recuerdoId (UUID). Dueño = userEmail (o email). Sin dueño → se omite.
//   pagado/payment_id se conservan tal cual; monto_esperado queda NULL (no se aplica
//   la tarifa nueva). Los pagados quedan con email_pago_enviado_en = fecha original
//   para que el reintento de emails no escriba a clientes históricos.
// - keychains: recuerdoId debe existir; inconsistencias (vinculado pero no usado,
//   recuerdo inexistente) se reportan y NO se importan.
// - data/recuerdos.json (4 registros impagos sin dueño) NO se importa.
// El informe se guarda en backend/migracion-historica/ (ignorada por Git) y solo
// muestra emails enmascarados.
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { isUuid, normalizarEmail, PACKS } = require("../../utils/validacion");
const { DIRS, rutaLocal } = require("../../utils/archivos");

const RAIZ = path.join(__dirname, "../..");
const SALIDA = path.join(RAIZ, "migracion-historica");

function enmascarar(email) {
  const [u, d] = String(email || "").split("@");
  return d ? `${u.slice(0, 2)}***@${d}` : "";
}

// Extended JSON → valores JS
function ejson(v) {
  if (Array.isArray(v)) return v.map(ejson);
  if (v && typeof v === "object") {
    if ("$oid" in v) return v.$oid;
    if ("$date" in v) {
      const d = v.$date;
      return new Date(typeof d === "object" && d.$numberLong ? Number(d.$numberLong) : d);
    }
    if ("$numberInt" in v) return Number(v.$numberInt);
    if ("$numberLong" in v) return Number(v.$numberLong);
    if ("$numberDouble" in v) return Number(v.$numberDouble);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = ejson(x);
    return o;
  }
  return v;
}

function leerExport(dir, nombre) {
  const archivo = path.join(dir, `${nombre}.json`);
  if (!fs.existsSync(archivo)) return null;
  const texto = fs.readFileSync(archivo, "utf8").trim();
  // --jsonArray o un documento por línea
  const docs = texto.startsWith("[") ? JSON.parse(texto) : texto.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  return docs.map(ejson);
}

function fecha(v) {
  const d = v instanceof Date ? v : v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function nuevoInforme(aplicar) {
  return {
    modo: aplicar ? "aplicar" : "simulacion",
    fecha: new Date().toISOString(),
    users: { leidos: 0, importados: 0, existentes: 0, googleIdOmitido: 0, errores: [] },
    recuerdos: { leidos: 0, importados: 0, existentes: 0, omitidos: [], errores: [], avisos: [], usuariosCreados: 0 },
    keychains: { leidos: 0, importados: 0, existentes: 0, omitidos: [], errores: [] },
    archivos: {}
  };
}

/* =========================
   IMPORTACIÓN
========================= */

async function importarUsers(prisma, docs, inf, aplicar) {
  for (const u of docs) {
    inf.users.leidos++;
    const email = normalizarEmail(u.email);
    if (!email) { inf.users.errores.push({ id: u._id, motivo: "sin_email" }); continue; }

    if (await prisma.user.findUnique({ where: { email } })) { inf.users.existentes++; continue; }

    let googleId = typeof u.googleId === "string" && u.googleId ? u.googleId : null;
    if (googleId && await prisma.user.findUnique({ where: { googleId } })) {
      googleId = null;
      inf.users.googleIdOmitido++;
    }

    if (aplicar) {
      try {
        await prisma.user.create({
          data: { email, googleId, name: u.name || null, picture: u.picture || null }
        });
      } catch (err) {
        inf.users.errores.push({ email: enmascarar(email), motivo: err.code || err.message });
        continue;
      }
    }
    inf.users.importados++;
  }
}

async function usuarioPorEmail(prisma, email, cache, inf, aplicar) {
  if (cache.has(email)) return cache.get(email);
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // dueño con email pero sin documento en users: se da de alta solo con su email
    inf.recuerdos.usuariosCreados++;
    user = aplicar ? await prisma.user.create({ data: { email } }) : { id: `simulado:${email}` };
  }
  cache.set(email, user);
  return user;
}

// Devuelve los ids importados (o importables, en simulación)
async function importarRecuerdos(prisma, docs, inf, aplicar) {
  const cache = new Map();
  const ids = new Set();
  const pagosVistos = new Set();

  for (const r of docs) {
    inf.recuerdos.leidos++;
    const id = r.recuerdoId;

    if (!isUuid(id)) { inf.recuerdos.errores.push({ id: r._id, motivo: "recuerdoId_no_uuid" }); continue; }
    if (await prisma.recuerdo.findUnique({ where: { id } })) { inf.recuerdos.existentes++; continue; }

    const email = normalizarEmail(r.userEmail) || normalizarEmail(r.email);
    if (!email) { inf.recuerdos.omitidos.push({ id, motivo: "sin_duenio" }); continue; }

    const avisos = [];

    let nombre = typeof r.nombre === "string" ? r.nombre.trim() : "";
    if (!nombre) { nombre = "Recuerdo"; avisos.push("nombre_vacio"); }
    if (nombre.length > 120) { nombre = nombre.slice(0, 120); avisos.push("nombre_recortado"); }

    let pack = r.pack;
    if (!PACKS.includes(pack)) { pack = "individual"; avisos.push(`pack_desconocido:${r.pack}`); }

    let audios = Array.isArray(r.audios) && r.audios.length
      ? r.audios.map((a, i) => ({ url: a?.url, orden: Number(a?.orden) || i + 1 }))
      : r.audioUrl ? [{ url: r.audioUrl, orden: 1 }] : [];
    audios = audios.filter(a => typeof a.url === "string" && a.url);

    const ordenes = audios.map(a => a.orden);
    if (ordenes.some(o => o < 1 || o > 2) || new Set(ordenes).size !== ordenes.length) {
      inf.recuerdos.errores.push({ id, motivo: "orden_de_audios_invalido" });
      continue;
    }
    if (!audios.length) avisos.push("sin_audios");

    for (const a of audios) {
      const local = rutaLocal(a.url);
      if (!local) avisos.push(`audio_url_no_local:${a.url}`);
      else if (!fs.existsSync(local)) avisos.push(`audio_faltante:${path.basename(local)}`);
    }
    if (r.qrUrl) {
      const local = rutaLocal(r.qrUrl);
      if (local && !fs.existsSync(local)) avisos.push(`qr_faltante:${path.basename(local)}`);
    }

    const paymentId = r.payment_id ? String(r.payment_id).slice(0, 64) : null;
    if (paymentId && (pagosVistos.has(paymentId) || await prisma.recuerdo.findUnique({ where: { paymentId } }))) {
      inf.recuerdos.errores.push({ id, motivo: "payment_id_ya_usado" });
      continue;
    }

    const pagado = r.pagado === true;
    const creado = fecha(r.creadoEn) || new Date();

    if (aplicar) {
      try {
        const user = await usuarioPorEmail(prisma, email, cache, inf, aplicar);
        await prisma.recuerdo.create({
          data: {
            id,
            userId: user.id,
            nombre,
            pack,
            qrUrl: r.qrUrl || null,
            pagado,
            paymentId,
            payerEmail: normalizarEmail(r.payerEmail) || null,
            createdAt: creado,
            // el sistema anterior ya gestionó (o no) el email: no reenviar
            emailPagoEnviadoEn: pagado ? creado : null,
            audios: { create: audios }
          }
        });
      } catch (err) {
        inf.recuerdos.errores.push({ id, motivo: err.code || err.message });
        continue;
      }
    } else {
      await usuarioPorEmail(prisma, email, cache, inf, aplicar);
    }

    if (avisos.length) inf.recuerdos.avisos.push({ id, avisos });
    inf.recuerdos.importados++;
    ids.add(id);
    if (paymentId) pagosVistos.add(paymentId);
  }

  return ids;
}

async function importarKeychains(prisma, docs, inf, aplicar, idsImportables) {
  const vinculados = new Set();

  for (const k of docs) {
    inf.keychains.leidos++;
    const qrId = typeof k.qrId === "string" ? k.qrId.trim() : "";

    if (!/^[A-Za-z0-9_-]{1,32}$/.test(qrId)) { inf.keychains.errores.push({ qrId, motivo: "qrId_invalido" }); continue; }
    if (await prisma.keychain.findUnique({ where: { qrId } })) { inf.keychains.existentes++; continue; }

    const pack = PACKS.includes(k.pack) ? k.pack : null;
    if (!pack) { inf.keychains.omitidos.push({ qrId, motivo: `pack_desconocido:${k.pack}` }); continue; }

    const usado = k.usado === true;
    const recuerdoId = k.recuerdoId || null;

    if (recuerdoId) {
      if (!usado) { inf.keychains.omitidos.push({ qrId, motivo: "vinculado_pero_no_usado" }); continue; }
      const existe = idsImportables.has(recuerdoId) || (isUuid(recuerdoId) && await prisma.recuerdo.findUnique({ where: { id: recuerdoId } }));
      if (!existe) { inf.keychains.omitidos.push({ qrId, motivo: "recuerdo_inexistente" }); continue; }
      if (vinculados.has(recuerdoId) || await prisma.keychain.findUnique({ where: { recuerdoId } })) {
        inf.keychains.omitidos.push({ qrId, motivo: "recuerdo_ya_vinculado_a_otro_llavero" });
        continue;
      }
      vinculados.add(recuerdoId);
    }

    if (aplicar) {
      try {
        await prisma.keychain.create({
          data: {
            qrId,
            pack,
            usado,
            recuerdoId,
            escaneos: Math.max(0, Number(k.escaneos) || 0),
            activadoEn: fecha(k.activadoEn),
            createdAt: fecha(k.creadoEn) || new Date()
          }
        });
      } catch (err) {
        inf.keychains.errores.push({ qrId, motivo: err.code || err.message });
        continue;
      }
    }
    inf.keychains.importados++;
  }
}

function uuidDesdeMongoId(id) {
  const hex = String(id || "")
    .replace(/[^a-fA-F0-9]/g, "")
    .toLowerCase();

  if (!/^[a-f0-9]{24}$/.test(hex)) return null;

  const h = `${hex}00000000`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function importarEventosYQrs(prisma, dir, inf, aplicar) {
  inf.eventos = { leidos: 0, importados: 0, existentes: 0, omitidos: [], errores: [] };
  inf.qrsEventos = { leidos: 0, importados: 0, existentes: 0, omitidos: [], errores: [] };

  const eventos = leerExport(dir, "events");
  const qrs = leerExport(dir, "qrs");
  const usuarios = leerExport(dir, "users");

  if (!eventos || !qrs || !usuarios) {
    throw new Error("Faltan events.json, qrs.json o users.json en el export.");
  }

  // Relaciona el ID original de Mongo con el email del usuario.
  const emailPorMongoId = new Map(
    usuarios
      .filter(u => u._id && normalizarEmail(u.email))
      .map(u => [String(u._id), normalizarEmail(u.email)])
  );

  const userIdPorMongoId = new Map();

for (const [mongoId, email] of emailPorMongoId) {
  let user = await prisma.user.findUnique({ where: { email } });

  // En simulación, los usuarios todavía no existen en PostgreSQL.
  if (!user && !aplicar) {
    user = { id: `simulado:${email}` };
  }

  if (!user && aplicar) {
    user = await prisma.user.create({ data: { email } });
  }

  if (user) userIdPorMongoId.set(mongoId, user.id);
}
  const eventIdPorMongoId = new Map();

  for (const e of eventos) {
    inf.eventos.leidos++;
    const id = uuidDesdeMongoId(e._id);
    const userId = userIdPorMongoId.get(String(e.userId));

    if (!id || !userId) {
      inf.eventos.omitidos.push({
        id: e._id,
        motivo: !id ? "id_mongo_invalido" : "usuario_no_encontrado"
      });
      continue;
    }

    eventIdPorMongoId.set(String(e._id), id);
    const existente = await prisma.event.findUnique({ where: { id } });

    if (existente) {
      inf.eventos.existentes++;
      continue;
    }

    if (aplicar) {
      try {
        await prisma.event.create({
          data: {
            id,
            userId,
            name: String(e.name || "Evento").trim().slice(0, 200) || "Evento",
            createdAt: fecha(e.date) || fecha(e.createdAt) || new Date()
          }
        });
      } catch (err) {
        inf.eventos.errores.push({ id: e._id, motivo: err.code || err.message });
        continue;
      }
    }

    inf.eventos.importados++;
  }

  for (const q of qrs) {
    inf.qrsEventos.leidos++;
    const qrId = String(q.qrId || "");
    const eventId = eventIdPorMongoId.get(String(q.eventId));

    if (!isUuid(qrId)) {
      inf.qrsEventos.errores.push({ qrId, motivo: "qrId_no_uuid" });
      continue;
    }

    const existente = await prisma.eventQr.findUnique({ where: { qrId } });
    if (existente) {
      inf.qrsEventos.existentes++;
      continue;
    }

    if (!eventId) {
      inf.qrsEventos.omitidos.push({ qrId, motivo: "evento_no_importable" });
      continue;
    }

    const status = q.status === "completed" ? "completed" : "empty";
    const name = String(q.name || "Invitado").trim().slice(0, 120) || "Invitado";
    const audioUrl = typeof q.audioUrl === "string" ? q.audioUrl : "";

    if (aplicar) {
      try {
        await prisma.eventQr.create({
          data: {
            qrId,
            eventId,
            name,
            audioUrl,
            status,
            createdAt: fecha(q.createdAt) || new Date()
          }
        });
      } catch (err) {
        inf.qrsEventos.errores.push({ qrId, motivo: err.code || err.message });
        continue;
      }
    }

    inf.qrsEventos.importados++;
  }
}


/* =========================
   INVENTARIO DE ARCHIVOS
========================= */

async function inventarioArchivos(prisma, recuerdosExport) {
  const listar = (dir, ext) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)) : []);
  const audiosDisco = listar(DIRS.audio, ".mp3");
  const qrDisco = listar(DIRS.qr, ".png");

  const refs = new Set();
  for (const a of await prisma.recuerdoAudio.findMany({ select: { url: true } })) refs.add(a.url);
  for (const r of await prisma.recuerdo.findMany({ select: { qrUrl: true } })) if (r.qrUrl) refs.add(r.qrUrl);

  for (const r of recuerdosExport || []) {
    for (const a of r.audios || []) if (a?.url) refs.add(a.url);
    if (r.audioUrl) refs.add(r.audioUrl);
    if (r.qrUrl) refs.add(r.qrUrl);
  }

  let json = [];
  const jsonPath = path.join(RAIZ, "data/recuerdos.json");
  if (fs.existsSync(jsonPath)) json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  for (const r of json) {
    if (r.archivo) refs.add(`/audio/${r.archivo}`);
    if (r.qr) refs.add(`/qr/${r.qr}`);
  }

  const sinReferencia = [
    ...audiosDisco.filter(f => !refs.has(`/audio/${f}`)).map(f => `audio/${f}`),
    ...qrDisco.filter(f => !refs.has(`/qr/${f}`)).map(f => `qr/${f}`)
  ];

  return {
    audiosEnDisco: audiosDisco.length,
    qrEnDisco: qrDisco.length,
    temporales: listar(DIRS.temp, "").length,
    registrosDataJson: json.length,
    dataJsonEstados: json.reduce((acc, r) => ({ ...acc, [r.estado]: (acc[r.estado] || 0) + 1 }), {}),
    referenciasConocidas: refs.size,
    archivosSinReferencia: sinReferencia.length,
    archivosSinReferenciaLista: sinReferencia,
    nota: recuerdosExport ? "incluye referencias del export de MongoDB" : "sin export de MongoDB: los archivos sin referencia probablemente pertenecen a recuerdos que solo están en MongoDB"
  };
}

/* =========================
   MAIN
========================= */

async function reconciliar(prisma, { dir, aplicar = false } = {}) {
  const inf = nuevoInforme(aplicar);
  let recuerdos = null;

  if (dir) {
    const users = leerExport(dir, "users");
    recuerdos = leerExport(dir, "recuerdos");
    const keychains = leerExport(dir, "keychains");

    if (!users || !recuerdos || !keychains) {
      throw new Error("La carpeta debe contener users.json, recuerdos.json y keychains.json");
    }

    await importarUsers(prisma, users, inf, aplicar);
    // en simulación los recuerdos no existen todavía: se consideran los importables
    const importables = await importarRecuerdos(prisma, recuerdos, inf, aplicar);
    await importarKeychains(prisma, keychains, inf, aplicar, importables);
    await importarEventosYQrs(prisma, dir, inf, aplicar);
  }

  inf.archivos = await inventarioArchivos(prisma, recuerdos);

  if (aplicar) {
    inf.verificacion = {
      eventos: await prisma.event.count(),
qrsEventos: await prisma.eventQr.count(),
      users: await prisma.user.count(),
      recuerdos: await prisma.recuerdo.count(),
      recuerdosPagados: await prisma.recuerdo.count({ where: { pagado: true } }),
      audios: await prisma.recuerdoAudio.count(),
      keychains: await prisma.keychain.count(),
      keychainsVinculados: await prisma.keychain.count({ where: { recuerdoId: { not: null } } })
    };
  }

  return inf;
}

if (require.main === module) {
  const prisma = require("../../db/prisma");
  const i = process.argv.indexOf("--dir");
  const dir = i === -1 ? null : path.resolve(process.argv[i + 1] || "");
  const aplicar = process.argv.includes("--aplicar");

  if (aplicar && !dir) {
    console.error("--aplicar requiere --dir <carpeta-export>");
    process.exit(1);
  }

  reconciliar(prisma, { dir, aplicar })
    .then(inf => {
      fs.mkdirSync(SALIDA, { recursive: true });
      const archivo = path.join(SALIDA, `informe-${inf.modo}-${inf.fecha.replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(archivo, JSON.stringify(inf, null, 2));
      const { archivosSinReferenciaLista, ...archivos } = inf.archivos;
      console.log(JSON.stringify({ ...inf, archivos, recuerdos: resumen(inf.recuerdos), keychains: resumen(inf.keychains), users: resumen(inf.users) }, null, 2));
      console.log(`Informe completo: ${archivo}`);
    })
    .catch(err => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

function resumen(sec) {
  const out = {};
  for (const [k, v] of Object.entries(sec)) out[k] = Array.isArray(v) ? v.length : v;
  return out;
}

module.exports = { reconciliar, ejson };
