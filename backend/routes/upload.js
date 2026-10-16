const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const Recuerdo = require("../models/Recuerdo");
const auth = require("../middleware/auth");
const convertirAudio = require("../utils/convertirAudio");
const fs = require("fs");
const router = express.Router();

/* =========================
   CONFIG MULTER
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads/temp"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp3";
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
   fileFilter: (req, file, cb) => {
  console.log("TIPO ARCHIVO:", file.mimetype);
  cb(null, true);
}

});

/* =========================
   POST /api/upload
========================= */
router.post(
  "/upload",
  auth,
  upload.fields([
    { name: "audio1", maxCount: 1 },
    { name: "audio2", maxCount: 1 }
  ]),
  async (req, res) => {

    try {

      const { nombre, pack } = req.body;
      const key = req.query.key;

      let keychain = null;

      // 🔑 SI VIENE DE LLAVERO
      if (key) {

        const Keychain = require("../models/Keychain");

        keychain = await Keychain.findOne({ qrId: key });

        if (!keychain) {
          return res.status(400).json({ error: "Llavero inválido" });
        }

        // 🚫 evitar reutilizar llavero
        if (keychain.usado) {
          return res.status(403).json({ error: "Este llavero ya fue activado" });
        }

        // 🚫 evitar pack incorrecto
        if (keychain.pack !== pack) {
          return res.status(403).json({ error: "Pack no permitido para este llavero" });
        }

      }

      const audio1 = req.files.audio1?.[0];
      const audio2 = req.files.audio2?.[0];

      if (!nombre || !audio1) {
        return res.status(400).json({ error: "Datos incompletos" });
      }

      if (pack === "pareja" && !audio2) {
        return res.status(400).json({ error: "Falta segundo audio" });
      }

      const recuerdoId = uuidv4();

       const audio1TempPath = audio1.path;
const audio1FinalName = `${uuidv4()}.mp3`;
const audio1FinalPath = path.join(__dirname, "../uploads/audio", audio1FinalName);

await convertirAudio(audio1TempPath, audio1FinalPath);
fs.unlinkSync(audio1TempPath);

const audios = [
  { url: `/audio/${audio1FinalName}`, orden: 1 }
];


      if (pack === "pareja") {
        const audio2TempPath = audio2.path;
const audio2FinalName = `${uuidv4()}.mp3`;
const audio2FinalPath = path.join(__dirname, "../uploads/audio", audio2FinalName);

await convertirAudio(audio2TempPath, audio2FinalPath);
fs.unlinkSync(audio2TempPath);

audios.push({
  url: `/audio/${audio2FinalName}`,
  orden: 2
});

      }

      const recuerdoUrl = `https://reqrdito.com/recuerdo.html?id=${recuerdoId}`;

      const qrPath = path.join(
        __dirname,
        "../uploads/qr",
        `${recuerdoId}.png`
      );

      await QRCode.toFile(qrPath, recuerdoUrl);

      await Recuerdo.create({
        recuerdoId,
        nombre,
        pack,
        audios,
        qrUrl: `/qr/${recuerdoId}.png`,
        pagado: key ? true : false,
        userEmail: req.user.email
      });

      // 🔑 MARCAR LLAVERO COMO USADO
      if (key && keychain) {

        keychain.usado = true;
        keychain.recuerdoId = recuerdoId;
        keychain.nombreRecuerdo = nombre;
        keychain.activadoEn = new Date();

        await keychain.save();

      }

      res.json({ id: recuerdoId });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: "Error creando recuerdo"
      });

    }

  }
);

module.exports = router;
