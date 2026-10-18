// Entorno de pruebas: base PostgreSQL de test + dobles de servicios externos.
// Google, Mercado Pago, el envío de emails y ffmpeg se reemplazan para que
// ninguna prueba haga llamadas reales, cobre ni envíe correos.

require("dotenv").config({ quiet: true });

const path = require("path");
const fs = require("fs");
const { verificarBaseDePruebas } = require("../scripts/lib/baseDePruebas");

// Las pruebas hacen TRUNCATE de todas las tablas: mismas garantías que el reset
verificarBaseDePruebas({
  testUrl: process.env.TEST_DATABASE_URL,
  principalUrl: process.env.DATABASE_URL,
  permiso: process.env.ALLOW_TEST_DB_RESET,
  nodeEnv: process.env.NODE_ENV
});

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = "secreto-solo-para-tests-con-32-caracteres!";
process.env.GOOGLE_CLIENT_ID = "client-id-de-prueba";
process.env.MP_ACCESS_TOKEN = "TEST-token-falso";
process.env.BREVO_PASS = "";
process.env.EMAIL_ENABLED = "false";
process.env.EVENTS_ENABLED = "false";
process.env.ADMIN_EMAILS = "admin@example.com";
delete process.env.FRONTEND_URL;
delete process.env.API_URL;
delete process.env.QR_RECUERDO_BASE;
delete process.env.CORS_ORIGINS;

const ROOT = path.join(__dirname, "..");
const ADMIN = "admin@example.com";

function mockModule(request, exportsValue) {
  const resolved = require.resolve(request, { paths: [ROOT] });
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };
}

/* ---------- Email ---------- */
// emails.fallar = true simula una caída del SMTP
const emails = [];
emails.fallar = false;
const { renderTemplate } = require("../services/emailService.js");
mockModule(path.join(ROOT, "services/emailService.js"), {
  renderTemplate,
  sendEmail: async (to, subject, template, variables) => {
    renderTemplate(template, variables); // la plantilla debe existir y renderizar
    if (emails.fallar) throw new Error("SMTP caído (simulado)");
    emails.push({ to, subject, template, variables });
    return { enviado: true };
  }
});

/* ---------- ffmpeg (convertirAudio) ---------- */
// Un archivo cuyo contenido empieza con "NO-AUDIO" se comporta como ffmpeg
// ante un archivo que no es audio: deja un MP3 parcial y falla.
class AudioInvalidoError extends Error {
  constructor(m) { super(m); this.name = "AudioInvalidoError"; }
}
const convertirAudioMock = async (input, output) => {
  const contenido = fs.readFileSync(input);
  if (contenido.subarray(0, 8).toString() === "NO-AUDIO") {
    fs.writeFileSync(output, "parcial");
    fs.unlinkSync(output);
    throw new AudioInvalidoError("Archivo de audio inválido");
  }
  fs.copyFileSync(input, output);
  return output;
};
convertirAudioMock.AudioInvalidoError = AudioInvalidoError;
mockModule(path.join(ROOT, "utils/convertirAudio.js"), convertirAudioMock);

/* ---------- ffmpeg (convertirImagen) ---------- */
// Mismo control de formato que el real; la "conversión" copia el archivo
const convertirImagenReal = require("../utils/convertirImagen");
const convertirImagenMock = async (input, output) => {
  if (!convertirImagenReal.esImagenAceptada(input)) {
    throw new convertirImagenReal.ImagenInvalidaError("Formato de imagen no aceptado");
  }
  fs.copyFileSync(input, output);
  return output;
};
Object.assign(convertirImagenMock, convertirImagenReal);
mockModule(path.join(ROOT, "utils/convertirImagen.js"), convertirImagenMock);

/* ---------- Google ---------- */
// El "idToken" de prueba es un JSON con el payload; "invalido" falla.
class OAuth2Client {
  async verifyIdToken({ idToken }) {
    if (idToken === "invalido") throw new Error("Token de Google inválido");
    const payload = JSON.parse(idToken);
    return { getPayload: () => payload };
  }
}
mockModule("google-auth-library", { OAuth2Client });

/* ---------- Mercado Pago ---------- */
const mp = {
  pagos: new Map(),      // paymentId -> respuesta de Payment.get
  preferencias: [],      // bodies enviados a Preference.create
  consultas: 0,
  busquedas: 0,
  // si se define, reemplaza los resultados de Payment.search (lo que "dice" la búsqueda)
  resultadosBusqueda: null
};
class MercadoPagoConfig { constructor(opts) { this.opts = opts; } }
class Preference {
  async create({ body }) {
    mp.preferencias.push(body);
    return { id: `pref-${mp.preferencias.length}`, init_point: "https://mp.test/checkout" };
  }
}
class Payment {
  async get({ id }) {
    mp.consultas++;
    const info = mp.pagos.get(String(id));
    if (!info) throw new Error("Pago inexistente");
    return { id: Number(id), ...info };
  }
  async search({ options } = {}) {
    mp.busquedas++;
    const ref = options?.external_reference;
    if (mp.resultadosBusqueda) return { results: mp.resultadosBusqueda(ref) };
    const results = [...mp.pagos.entries()]
      .filter(([, p]) => p.external_reference === ref)
      .map(([id, p]) => ({ id: Number(id), ...p }));
    return { results };
  }
}
mockModule("mercadopago", { MercadoPagoConfig, Preference, Payment });

/* ---------- Meta (API de conversiones) ---------- */
// Los eventos quedan en metaEventos en lugar de salir a graph.facebook.com
const metaEventos = [];
const metaCapi = require("../services/metaCapi");
metaCapi.enviarEvento = async (evento) => { metaEventos.push(evento); return "enviado"; };

/* ---------- App ---------- */
const jwt = require("jsonwebtoken");
const prisma = require("../db/prisma");
const app = require("../app");

const servidores = [];
let baseUrl;

async function escuchar(aplicacion) {
  const server = await new Promise(resolve => {
    const s = aplicacion.listen(0, "127.0.0.1", () => resolve(s));
  });
  servidores.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function iniciar() {
  baseUrl = await escuchar(app);
  return baseUrl;
}

// Segunda instancia con el módulo de eventos habilitado (para probarlo conservado)
async function iniciarConEventos() {
  return escuchar(app.crearApp({ eventsEnabled: true }));
}

async function detener() {
  await Promise.all(servidores.map(s => new Promise(resolve => s.close(resolve))));
  await prisma.$disconnect();
}

async function limpiarBase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "pagos_revision", "event_qrs", "events", "keychains", "recuerdo_audios", "recuerdos", "users" CASCADE'
  );
  emails.length = 0;
  emails.fallar = false;
  metaEventos.length = 0;
  mp.pagos.clear();
  mp.preferencias.length = 0;
  mp.consultas = 0;
  mp.busquedas = 0;
  mp.resultadosBusqueda = null;
}

function api(ruta, { method = "GET", token, json, form, headers: extra = {}, redirect = "manual", base } = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = typeof json === "string" ? json : JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  return fetch((base || baseUrl) + ruta, { method, headers, body, redirect });
}

// Login real contra /api/auth/google con un payload de Google simulado
async function login(email, extra = {}, base) {
  const res = await api("/api/auth/google", {
    method: "POST",
    base,
    json: { credential: JSON.stringify({ email, name: "Persona de prueba", sub: `sub-${email}`, email_verified: true, ...extra }) }
  });
  const data = await res.json();
  return data.token;
}

function loginAdmin(base) {
  return login(ADMIN, {}, base);
}

function tokenPara(email, extra = {}) {
  return jwt.sign({ email, ...extra }, process.env.JWT_SECRET, { expiresIn: "5m" });
}

// JPEG mínimo con firma válida (el doble de convertirImagen solo mira la firma)
function fotoFalsa(tipo = "image/jpeg") {
  return new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])], { type: tipo });
}

function audioFalso() {
  return new Blob([Buffer.from("audio-de-prueba")], { type: "audio/webm" });
}

// Archivos creados en uploads/ por las pruebas, para borrarlos al final
function borrarArchivosSubidos(rutasPublicas) {
  for (const ruta of rutasPublicas) {
    if (!ruta) continue;
    const local = ruta.startsWith("/audio/")
      ? path.join(ROOT, "uploads/audio", path.basename(ruta))
      : ruta.startsWith("/qr/")
        ? path.join(ROOT, "uploads/qr", path.basename(ruta))
        : ruta.startsWith("/foto/")
          ? path.join(ROOT, "uploads/foto", path.basename(ruta))
          : null;
    if (local && fs.existsSync(local)) fs.unlinkSync(local);
  }
}

// Archivos apartados por borrados de prueba (uploads/eliminados/<recuerdoId>)
function borrarApartados(recuerdoIds) {
  for (const id of recuerdoIds) {
    const dir = path.join(ROOT, "uploads/eliminados", path.basename(id));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Sube un recuerdo y registra sus archivos para limpiarlos al final
function crearSubidor(archivosCreados) {
  return async function subirRecuerdo(token, { nombre = "Abuela", pack = "individual", key, dosAudios = false, audio, base, foto, extra = {} } = {}) {
    const form = new FormData();
    if (nombre !== null) form.append("nombre", nombre);
    form.append("pack", pack);
    form.append("audio1", audio || audioFalso(), "grabacion.webm");
    if (dosAudios) form.append("audio2", audioFalso(), "grabacion2.webm");
    // foto: un Blob o una lista (hasta 4, en orden)
    for (const [i, f] of [].concat(foto || []).entries()) form.append("foto", f, `foto${i + 1}.jpg`);
    for (const [campo, valor] of Object.entries(extra)) form.append(campo, valor);
    const ruta = key !== undefined ? `/api/upload?key=${encodeURIComponent(key)}` : "/api/upload";
    const res = await api(ruta, { method: "POST", token, form, base });
    const data = await res.json();
    if (data.id) {
      const r = await prisma.recuerdo.findUnique({ where: { id: data.id }, include: { audios: true, fotos: true } });
      if (r) archivosCreados.push(r.qrUrl, ...r.fotos.map(f => f.url), ...r.audios.map(a => a.url));
    }
    return { res, data };
  };
}

// Pago aprobado simulado en Mercado Pago
function pagoAprobado(id, recuerdoId, { monto, moneda = "ARS", status = "approved", payer = "pagador@example.com" } = {}) {
  mp.pagos.set(String(id), {
    status,
    external_reference: `REQRDITO_${recuerdoId}`,
    transaction_amount: monto,
    currency_id: moneda,
    payer: { email: payer }
  });
}

function webhook(paymentId, extra = {}) {
  return api("/api/webhook", { method: "POST", json: { type: "payment", data: { id: String(paymentId) }, ...extra } });
}

function contarArchivos(subdir) {
  const dir = path.join(ROOT, "uploads", subdir);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !f.startsWith(".")).length : 0;
}

module.exports = {
  ROOT,
  ADMIN,
  prisma,
  emails,
  metaEventos,
  mp,
  iniciar,
  iniciarConEventos,
  detener,
  limpiarBase,
  api,
  login,
  loginAdmin,
  tokenPara,
  audioFalso,
  fotoFalsa,
  borrarArchivosSubidos,
  borrarApartados,
  crearSubidor,
  pagoAprobado,
  webhook,
  contarArchivos
};
