const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const prisma = require("../db/prisma");
const auth = require("../middleware/auth");
const requireAuth = require("../middleware/requireAuth");
const convertirAudio = require("../utils/convertirAudio");
const { PACKS, codigoLlaveroValido } = require("../utils/validacion");
const { DIRS, borrarSiExiste } = require("../utils/archivos");
const { config } = require("../config/env");
const router = express.Router();

/* =========================
   CONFIG MULTER
========================= */
const EXTENSIONES = [".mp3", ".m4a", ".mp4", ".aac", ".wav", ".ogg", ".oga", ".opus", ".webm", ".weba", ".flac", ".3gp", ".caf", ".amr"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, DIRS.temp);
  },
  filename: (req, file, cb) => {
    // nombre propio: nunca se usa el nombre original más allá de una extensión conocida
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `${uuidv4()}${EXTENSIONES.includes(ext) ? ext : ".bin"}`);
  }
});

// Primer filtro (MIME o extensión). La validación real del contenido la hace
// ffmpeg al convertir: si no puede decodificar audio, se rechaza con 422.
function fileFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mimeOk = mime.startsWith("audio/") || ["video/mp4", "video/webm", "video/3gpp", "video/quicktime"].includes(mime);
  const extOk = EXTENSIONES.includes(ext);

  if (mimeOk || (extOk && (mime === "" || mime === "application/octet-stream"))) {
    return cb(null, true);
  }
  cb(new Error("Archivo no válido"), false);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 2,
    fields: 10
  }
});

class ErrorHttp extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* =========================
   POST /api/upload
========================= */
router.post(
  "/upload",
  auth,
  requireAuth,
  upload.fields([
    { name: "audio1", maxCount: 1 },
    { name: "audio2", maxCount: 1 }
  ]),
  async (req, res) => {

    const temporales = [
      req.files?.audio1?.[0]?.path,
      req.files?.audio2?.[0]?.path
    ];
    const generados = [];

    try {

      const nombre = typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";
      const pack = req.body.pack || "individual";
      const key = req.query.key;

      if (!PACKS.includes(pack)) {
        return res.status(400).json({ error: "Pack inválido" });
      }

      // 🔑 SI VIENE DE LLAVERO
      if (key !== undefined) {

        if (!codigoLlaveroValido(key)) {
          return res.status(400).json({ error: "Llavero inválido" });
        }

        const keychain = await prisma.keychain.findUnique({ where: { qrId: key } });

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

      const audio1 = req.files?.audio1?.[0];
      const audio2 = req.files?.audio2?.[0];

      if (!nombre || !audio1) {
        return res.status(400).json({ error: "Datos incompletos" });
      }

      if (nombre.length > 120) {
        return res.status(400).json({ error: "El nombre es demasiado largo" });
      }

      if (pack === "pareja" && !audio2) {
        return res.status(400).json({ error: "Falta segundo audio" });
      }

      const recuerdoId = uuidv4();

      // 🎧 Convertir a MP3 (los archivos quedan en disco, la base guarda la ruta)
      const archivos = pack === "pareja" ? [audio1, audio2] : [audio1];
      const audios = [];

      for (const [i, archivo] of archivos.entries()) {
        const finalName = `${uuidv4()}.mp3`;
        const finalPath = path.join(DIRS.audio, finalName);

        // se registra antes de convertir para limpiar también un MP3 parcial
        generados.push(finalPath);
        await convertirAudio(archivo.path, finalPath);
        borrarSiExiste(archivo.path);

        audios.push({ url: `/audio/${finalName}`, orden: i + 1 });
      }

      // Mismo formato que los QR ya impresos: no cambiar el dominio
      const recuerdoUrl = `${config.qrRecuerdoBase}/recuerdo.html?id=${recuerdoId}`;

      const qrPath = path.join(DIRS.qr, `${recuerdoId}.png`);

      generados.push(qrPath);
      await QRCode.toFile(qrPath, recuerdoUrl);

      await prisma.$transaction(async (tx) => {

        await tx.recuerdo.create({
          data: {
            id: recuerdoId,
            userId: req.user.id,
            nombre,
            pack,
            qrUrl: `/qr/${recuerdoId}.png`,
            // el llavero físico ya se pagó al comprarlo
            pagado: key !== undefined,
            audios: { create: audios }
          }
        });

        // 🔑 MARCAR LLAVERO COMO USADO (condicional: evita doble activación simultánea)
        if (key !== undefined) {
          const { count } = await tx.keychain.updateMany({
            where: { qrId: key, usado: false, pack },
            data: {
              usado: true,
              recuerdoId,
              activadoEn: new Date()
            }
          });

          if (count === 0) {
            throw new ErrorHttp(403, "Este llavero ya fue activado");
          }
        }
      });

      res.json({ id: recuerdoId });

    } catch (err) {

      // solo archivos creados por ESTA petición (nombres UUID nuevos)
      generados.forEach(borrarSiExiste);

      if (err instanceof ErrorHttp) {
        return res.status(err.status).json({ error: err.message });
      }

      if (err.name === "AudioInvalidoError") {
        return res.status(422).json({ error: "El archivo no es un audio válido" });
      }

      console.error("ERROR UPLOAD:", err.message);

      res.status(500).json({
        error: "Error creando recuerdo"
      });

    } finally {
      temporales.forEach(borrarSiExiste);
    }

  }
);

module.exports = router;
