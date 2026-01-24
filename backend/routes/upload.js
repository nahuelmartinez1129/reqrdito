const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const Recuerdo = require("../models/Recuerdo");
const auth = require("../middleware/auth");

const router = express.Router();

/* =========================
   CONFIG MULTER
   Compatible desktop + mobile
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/audio"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp3";
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos de audio"));
    }
  }
});

/* =========================
   POST /api/upload
   Protegida con JWT
========================= */
router.post(
  "/upload",
  auth,
  upload.single("audio"),
  async (req, res) => {
    try {
      const { nombre } = req.body;

      if (!nombre) {
        return res.status(400).json({ error: "Falta el nombre del recuerdo" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No se subió ningún audio" });
      }

      // 🔎 LOG (útil para debug mobile)
      console.log("📥 AUDIO SUBIDO:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        sizeMB: (req.file.size / 1024 / 1024).toFixed(2)
      });

      const recuerdoId = uuidv4();

      const audioUrl = `/audio/${req.file.filename}`;
      const recuerdoUrl = `https://reqrdito.com/recuerdo.html?id=${recuerdoId}`;

      // 📦 Generar QR
      const qrFileName = `${recuerdoId}.png`;
      const qrPath = path.join(__dirname, "../uploads/qr", qrFileName);

      await QRCode.toFile(qrPath, recuerdoUrl);

      const qrUrl = `/qr/${qrFileName}`;

      // 🧠 Guardar recuerdo
      await Recuerdo.create({
        recuerdoId,
        nombre,
        audioUrl,
        qrUrl,
        pagado: false,
        userEmail: req.user.email
      });

      // ✅ Respuesta
      res.json({
        id: recuerdoId,
        audioUrl
      });

    } catch (error) {
      console.error("❌ UPLOAD ERROR:", error.message || error);
      res.status(500).json({
        error: "Error al crear el recuerdo"
      });
    }
  }
);

module.exports = router;
