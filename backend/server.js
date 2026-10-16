require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

// ROUTES
const keychainRoutes = require("./routes/keychainRoutes");
const uploadRoutes = require("./routes/upload");
const pagoRoutes = require("./routes/pago");
const recuerdoRoutes = require("./routes/recuerdo");
const webhookRoutes = require("./routes/webhook");
const descargaRoutes = require("./routes/descarga");
const misRecuerdosRoutes = require("./routes/misRecuerdos");
const authGoogleRoutes = require("./routes/authGoogle");
const keychainAdminRoutes = require("./routes/keychainAdminRoutes");
const authMiddleware = require("./middleware/auth");

// EVENTS
const eventsRoutes = require("./events/routes/eventsRoutes");

const app = express();

/* =========================
   CORS (FIX DEFINITIVO)
========================= */

app.use(cors({
  origin: true,
  credentials: true
}));

/* =========================
   MIDDLEWARES
========================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   ARCHIVOS ESTÁTICOS
========================= */

// audios y QR de llaveros
app.use("/audio", express.static(path.join(__dirname, "uploads/audio")));
app.use("/qr", express.static(path.join(__dirname, "uploads/qr")));

// eventos
app.use("/events-admin", express.static(path.join(__dirname, "events/admin-panel")));
app.use("/events-public", express.static(path.join(__dirname, "events/public")));

/* =========================
   DB + ROUTES
========================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => {

    console.log("🟢 MongoDB conectado");

    // API GENERAL
    app.use("/api", uploadRoutes);
    app.use("/api", pagoRoutes);
    app.use("/api", recuerdoRoutes);
    app.use("/api", webhookRoutes);
    app.use("/api", descargaRoutes);
    app.use("/api", misRecuerdosRoutes);

    // KEYCHAINS
    app.use("/api/keychain", keychainRoutes);
    app.use("/api/keychain-admin", keychainAdminRoutes);

    // GOOGLE AUTH
    app.use("/api", authGoogleRoutes);

    // EVENTS
    app.use("/events", authMiddleware, eventsRoutes);
    /* =========================
       SERVER
    ========================= */

    const PORT = 5000;

    app.listen(PORT, () => {
      console.log("🚀 Backend escuchando en puerto", PORT);
    });

  })
  .catch((err) => {
    console.error("🔴 Error conectando a MongoDB:", err);
    process.exit(1);
  });
