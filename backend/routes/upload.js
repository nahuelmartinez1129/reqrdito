const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const router = express.Router();

const DATA_PATH = path.join(__dirname, "../data/recuerdos.json");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/audio");
  },
  filename: (req, file, cb) => {
    const id = uuidv4();
    cb(null, `${id}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ storage });

router.post("/upload", upload.single("audio"), async (req, res) => {
  try {
    const nombre = req.body.nombre;
    if (!req.file || !nombre) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const id = req.file.filename.split(".")[0];

    // 👉 URL pública del recuerdo
    const urlRecuerdo = `http://localhost:5000/r/${id}`;

    // 👉 generar QR
    const qrPath = `uploads/qr/${id}.png`;
    await QRCode.toFile(qrPath, urlRecuerdo);

    const nuevoRecuerdo = {
      id,
      nombre,
      archivo: req.file.filename,
      qr: `${id}.png`,
      estado: "pendiente_pago",
      creado: new Date().toISOString()
    };

    const recuerdos = JSON.parse(fs.readFileSync(DATA_PATH));
    recuerdos.push(nuevoRecuerdo);
    fs.writeFileSync(DATA_PATH, JSON.stringify(recuerdos, null, 2));

    // ✅ ACÁ ESTÁ LO NUEVO
    res.json({
      id,
      audioUrl: `/audio/${req.file.filename}`,
      qr: `/uploads/qr/${id}.png`,
      url: urlRecuerdo
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el recuerdo" });
  }
});

module.exports = router;
