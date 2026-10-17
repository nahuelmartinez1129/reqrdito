const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { v4: uuidv4 } = require("uuid");
const { execFile } = require("child_process");

const prisma = require("../../db/prisma");
const { isUuid, normalizarEmail, enteroEnRango } = require("../../utils/validacion");
const { serializarEvento, serializarEventQr } = require("../../utils/serializers");

const router = express.Router();

const MAX_QRS_POR_TANDA = 500;

/* =========================
   STORAGE
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname); // 🔥 toma extensión real
    cb(null, Date.now() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("audio/") ||
      file.mimetype === "video/mp4" // 🔥 iPhone
    ) {
      cb(null, true);
    } else {
      cb(new Error("Archivo no válido"), false);
    }
  }
});

const incluirDueno = { event: { include: { user: true } } };

/* =========================
   CREAR EVENTO
========================= */
router.post("/create", async (req, res) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const emailCliente = normalizarEmail(req.body.emailCliente);

    if (!name || !emailCliente) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // el cliente puede no haber iniciado sesión todavía: se crea solo con su email
    const cliente = await prisma.user.upsert({
      where: { email: emailCliente },
      update: {},
      create: { email: emailCliente }
    });

    const event = await prisma.event.create({
      data: {
        name,
        userId: cliente.id
      }
    });

    res.json(serializarEvento(event));

  } catch (err) {
    console.error("ERROR CREATE EVENT:", err.message);
    res.status(500).json({ error: "Error creando evento" });
  }
});

/* =========================
   LISTAR TODOS
========================= */
router.get("/list", async (req, res) => {
  try {
    const events = await prisma.event.findMany({ orderBy: { createdAt: "desc" } });
    res.json(events.map(serializarEvento));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error listando eventos" });
  }
});

/* =========================
   GENERAR QRs
========================= */
router.post("/:eventId/generate-qrs", async (req, res) => {
  try {
    const cantidad = enteroEnRango(req.body.cantidad, 1, MAX_QRS_POR_TANDA);

    if (cantidad === null) {
      return res.status(400).json({ error: `Cantidad inválida (1 a ${MAX_QRS_POR_TANDA})` });
    }

    const event = isUuid(req.params.eventId)
      ? await prisma.event.findUnique({ where: { id: req.params.eventId } })
      : null;

    if (!event) return res.status(404).json({ error: "Evento no existe" });

    const ids = Array.from({ length: cantidad }, () => uuidv4());

    await prisma.eventQr.createMany({
      data: ids.map(qrId => ({ qrId, eventId: event.id }))
    });

    const qrs = [];

    for (const qrId of ids) {
      const url = `https://api.reqrdito.com/events/r/${qrId}`;
      const qrImg = await QRCode.toDataURL(url);

      qrs.push({
        qrId,
        qrImg
      });
    }

    res.json(qrs);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error generando QRs" });
  }
});

/* =========================
   LISTAR EVENTOS DE UN USUARIO
========================= */
router.get("/list/:userId", async (req, res) => {
  try {
    if (!isUuid(req.params.userId)) return res.json([]);

    const events = await prisma.event.findMany({
      where: { userId: req.params.userId },
      orderBy: { createdAt: "desc" }
    });
    res.json(events.map(serializarEvento));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error listando eventos" });
  }
});

/* =========================
   OBTENER QRs
========================= */
router.get("/:eventId/qrs", async (req, res) => {
  try {
    if (!isUuid(req.params.eventId)) return res.json([]);

    const qrs = await prisma.eventQr.findMany({
      where: { eventId: req.params.eventId },
      orderBy: { createdAt: "asc" },
      include: incluirDueno
    });
    res.json(qrs.map(serializarEventQr));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error obteniendo QRs" });
  }
});

/* =========================
   SUBIR AUDIO
========================= */
function convertirAMp3(inputPath, mp3Path) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k", mp3Path],
      (error) => (error ? reject(error) : resolve(mp3Path))
    );
  });
}

router.post("/qr/:qrId/audio", upload.single("audio"), async (req, res) => {
  const inputPath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Falta el audio" });
    }

    const qr = isUuid(req.params.qrId)
      ? await prisma.eventQr.findUnique({ where: { qrId: req.params.qrId } })
      : null;

    if (!qr) {
      fs.unlinkSync(inputPath);
      return res.status(404).json({ error: "QR no existe" });
    }

    const ext = path.extname(inputPath).toLowerCase();
    let finalPath = inputPath;

    // 🔥 SI NO ES MP3 → convertir
    if (ext !== ".mp3") {
      const mp3Path = path.join(path.dirname(inputPath), req.file.filename.replace(ext, "") + ".mp3");

      try {
        finalPath = await convertirAMp3(inputPath, mp3Path);
      } catch (error) {
        console.error("Error convirtiendo:", error.message);
        return res.status(500).json({ error: "Error convirtiendo audio" });
      }

      // borrar original
      fs.unlinkSync(inputPath);
    }

    const filename = path.basename(finalPath);
    const audioUrl = `https://api.reqrdito.com/events/audio/${filename}`;
    const name = typeof req.body.name === "string" && req.body.name.trim()
      ? req.body.name.trim().slice(0, 120)
      : "Invitado";

    await prisma.eventQr.update({
      where: { qrId: qr.qrId },
      data: { audioUrl, name, status: "completed" }
    });

    res.json({ ok: true });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error subiendo audio" });
  }
});

/* =========================
   ELIMINAR QR
========================= */
router.delete("/qr/:qrId", async (req, res) => {
  try {

    const qrId = req.params.qrId;

    const qr = isUuid(qrId)
      ? await prisma.eventQr.findUnique({ where: { qrId } })
      : null;

    if (!qr) {
      return res.status(404).json({ error: "QR no existe" });
    }

    await prisma.$transaction([
      // 🔥 eliminar QR
      prisma.eventQr.delete({ where: { qrId } }),
      // 🔥 eliminar recuerdo asociado (si existiera)
      prisma.recuerdo.deleteMany({ where: { id: qrId } })
    ]);

    res.json({ ok: true });

  } catch (err) {
    console.error("ERROR DELETE QR:", err.message);
    res.status(500).json({ error: "Error eliminando QR" });
  }
});

/* =========================
   REDIRECT QR
========================= */
router.get("/r/:qrId", async (req, res) => {
  try {
    const qr = isUuid(req.params.qrId)
      ? await prisma.eventQr.findUnique({ where: { qrId: req.params.qrId } })
      : null;

    if (!qr) {
      return res.status(404).send("QR no encontrado");
    }

    return res.redirect(
      `https://www.reqrdito.com/recuerdo-evento.html?qr=${qr.qrId}`
    );
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error servidor");
  }
});

/* =========================
   DATA QR
========================= */
router.get("/qr-data/:qrId", async (req, res) => {
  try {
    const qr = isUuid(req.params.qrId)
      ? await prisma.eventQr.findUnique({ where: { qrId: req.params.qrId } })
      : null;

    if (!qr) return res.status(404).json({ error: "No existe" });

    res.json({
      name: qr.name,
      file: qr.audioUrl,
      status: qr.status
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error del servidor" });
  }
});

/* =========================
   STATIC AUDIO
========================= */
// 🔥 FORZAR MIME PARA MP3
router.use("/audio", (req, res, next) => {
  if (req.url.endsWith(".mp3")) {
    res.setHeader("Content-Type", "audio/mpeg");
  }
  next();
});
router.use("/audio", express.static(path.join(__dirname, "../uploads")));

/* =========================
   OBTENER EVENTO
========================= */
router.get("/:id", async (req, res) => {
  try {
    const event = isUuid(req.params.id)
      ? await prisma.event.findUnique({ where: { id: req.params.id } })
      : null;

    if (!event) {
      return res.status(404).json({ error: "Evento no existe" });
    }

    res.json(serializarEvento(event));

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error obteniendo evento" });
  }
});

module.exports = router;
