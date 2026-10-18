const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const prisma = require("./db/prisma");
const { config } = require("./config/env");
const { DIRS } = require("./utils/archivos");

// ROUTES
const keychainRoutes = require("./routes/keychainRoutes");
const uploadRoutes = require("./routes/upload");
const pagoRoutes = require("./routes/pago");
const recuerdoRoutes = require("./routes/recuerdo");
const webhookRoutes = require("./routes/webhook");
const metaRoutes = require("./routes/meta");
const descargaRoutes = require("./routes/descarga");
const authGoogleRoutes = require("./routes/authGoogle");
const keychainAdminRoutes = require("./routes/keychainAdminRoutes");
const authMiddleware = require("./middleware/auth");
const requireAuth = require("./middleware/requireAuth");
const requireAdmin = require("./middleware/requireAdmin");

// Código legacy conservado pero NO montado:
// - routes/auth.js   → login viejo (token sin usuario en PostgreSQL, mail de bienvenida en cada login)
// - routes/public.js → lectura de data/recuerdos.json (4 registros históricos, ver docs/)

// Carpetas de archivos subidos (los audios viven en disco, no en la base)
for (const dir of [DIRS.temp, DIRS.audio, DIRS.qr, DIRS.foto]) {
  fs.mkdirSync(dir, { recursive: true });
}

/* =========================
   CORS: solo los orígenes de ReQRdito (y localhost fuera de producción)
========================= */
const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function origenPermitido(origin) {
  if (config.corsOrigins.includes(origin)) return true;
  return !config.produccion && LOCALHOST_RE.test(origin);
}

// opciones: { eventsEnabled } permite a los tests montar el módulo de eventos
function crearApp({ eventsEnabled = config.eventsEnabled } = {}) {
  const app = express();

  app.disable("x-powered-by");
  // las rutas compartidas (mis-recuerdos, borrar) consultan este flag
  app.locals.eventsEnabled = eventsEnabled;

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  app.use(cors({
    // sin Origin (escaneos de QR, webhooks de Mercado Pago, curl): se permite;
    // con Origin ajeno: la respuesta sale sin cabeceras CORS y el navegador la bloquea
    origin: (origin, cb) => cb(null, !origin || origenPermitido(origin)),
    credentials: false
  }));

  /* =========================
     MIDDLEWARES
  ========================= */

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));

  /* =========================
     ARCHIVOS ESTÁTICOS (uploads/temp y uploads/eliminados NO se exponen)
  ========================= */

  const estatico = { dotfiles: "deny", index: false, redirect: false };

  // audios, QR y fotos de recuerdos
  app.use("/audio", express.static(DIRS.audio, estatico));
  app.use("/qr", express.static(DIRS.qr, estatico));
  app.use("/foto", express.static(DIRS.foto, estatico));

  /* =========================
     SALUD (API + PostgreSQL)
  ========================= */

  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: "postgresql" });
    } catch (err) {
      console.error("Health check DB:", err.message);
      res.status(503).json({ ok: false, error: "Base de datos no disponible" });
    }
  });

  /* =========================
     ROUTES
  ========================= */

  // API GENERAL
  app.use("/api", uploadRoutes);
  app.use("/api", pagoRoutes);
  app.use("/api", recuerdoRoutes);
  app.use("/api", webhookRoutes);
  app.use("/api", descargaRoutes);
  app.use("/api", metaRoutes);

  // KEYCHAINS
  app.use("/api/keychain", keychainRoutes);
  app.use("/api/keychain-admin", keychainAdminRoutes);

  // GOOGLE AUTH
  app.use("/api", authGoogleRoutes);

  /* =========================
     EVENTS — deshabilitado temporalmente (EVENTS_ENABLED=false por defecto).
     Archivos, tablas y migraciones se conservan; para reactivarlo:
     EVENTS_ENABLED=true (y el panel exige un email de ADMIN_EMAILS).
  ========================= */

  if (eventsEnabled) {
    const eventsRoutes = require("./events/routes/eventsRoutes");
    const admin = [authMiddleware, requireAuth, requireAdmin];

    // Las páginas estáticas del panel no tienen datos; sus llamadas a la API sí exigen admin
    app.use("/events-admin", express.static(path.join(__dirname, "events/admin-panel"), estatico));
    app.use("/events-public", express.static(path.join(__dirname, "events/public"), estatico));

    // Públicas: lo que usan los invitados al escanear el QR del evento
    const esPublica = (req) =>
      (req.method === "GET" && /^\/(r|qr-data)\/[^/]+$/.test(req.path)) ||
      (req.method === "POST" && /^\/qr\/[^/]+\/audio$/.test(req.path)) ||
      (["GET", "HEAD"].includes(req.method) && req.path.startsWith("/audio/"));

    app.use("/events", (req, res, next) => (esPublica(req) ? eventsRoutes(req, res, next) : next()));

    // Administración
    app.use("/events", ...admin, eventsRoutes);
  } else {
    const deshabilitado = (req, res) => {
      res.status(503).json({ error: "Módulo de eventos deshabilitado temporalmente" });
    };
    app.use("/events", deshabilitado);
    app.use("/events-admin", deshabilitado);
    app.use("/events-public", deshabilitado);
  }

  /* =========================
     404 de la API
  ========================= */

  app.use("/api", (req, res) => {
    res.status(404).json({ error: "No encontrado" });
  });

  /* =========================
     ERRORES (JSON, sin stack trace)
  ========================= */

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === "MulterError") {
      const demasiadoGrande = err.code === "LIMIT_FILE_SIZE";
      return res.status(demasiadoGrande ? 413 : 400).json({
        error: demasiadoGrande ? "El archivo supera el máximo de 10 MB" : "Archivo no válido"
      });
    }

    if (err.message === "Archivo no válido") {
      return res.status(400).json({ error: err.message });
    }

    // JSON mal formado o cuerpo demasiado grande
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      return res.status(err.status || 400).json({ error: "Solicitud inválida" });
    }

    console.error("Error no controlado:", err.message);
    res.status(500).json({ error: "Error del servidor" });
  });

  return app;
}

module.exports = crearApp();
module.exports.crearApp = crearApp;
