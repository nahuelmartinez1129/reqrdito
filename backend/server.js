require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");

const uploadRoutes = require("./routes/upload");
const pagoRoutes = require("./routes/pago");
const recuerdoRoutes = require("./routes/recuerdo");
const webhookRoutes = require("./routes/webhook");
const descargaRoutes = require("./routes/descarga");
const authRoutes = require("./routes/auth");
const misRecuerdosRoutes = require("./routes/misRecuerdos");
const authGoogleRoutes = require("./routes/authGoogle");

const app = express();

/* =========================
   CORS
   ========================= */
app.use(cors({
  origin: [
    "https://reqrdito.com",
    "https://www.reqrdito.com",
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

/* =========================
   MIDDLEWARES
   ========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   ARCHIVOS ESTÁTICOS
   ========================= */
app.use("/audio", express.static(path.join(__dirname, "uploads/audio")));
app.use("/qr", express.static(path.join(__dirname, "uploads/qr")));

/* =========================
   CONEXIÓN A MONGODB
   ========================= */
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("🟢 MongoDB conectado");

    /* =========================
       RUTAS API
       ========================= */
        app.use("/api", uploadRoutes);
        app.use("/api", pagoRoutes);
        app.use("/api", recuerdoRoutes);
        app.use("/api", webhookRoutes);
        app.use("/api", descargaRoutes);
        app.use("/api/auth", authRoutes);
        app.use("/api", misRecuerdosRoutes);
        app.use("/api", authGoogleRoutes);

    const PORT = 5000;
    app.listen(PORT, () => {
      console.log("🚀 Backend escuchando en puerto", PORT);
    });
  })
  .catch((err) => {
    console.error("🔴 Error conectando a MongoDB:", err);
    process.exit(1); // 🔥 corta todo si Mongo falla
  });
