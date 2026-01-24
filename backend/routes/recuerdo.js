const express = require("express");
const Recuerdo = require("../models/Recuerdo");
const auth = require("../middleware/auth");
const { sendEmail } = require("../services/emailService");

const router = express.Router();

/* =========================
   POST /api/recuerdo
   (CREAR RECUERDO)
   ========================= */
router.post("/recuerdo", auth, async (req, res) => {
  try {
    const { nombre, qrUrl, audioUrl, recuerdoId } = req.body;
    const userEmail = req.user.email;

    if (!recuerdoId || !audioUrl) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const nuevoRecuerdo = new Recuerdo({
      nombre,
      qrUrl,
      audioUrl,
      recuerdoId,
      userEmail,
      pagado: true,
      creadoEn: new Date()
    });

    await nuevoRecuerdo.save();

    // 📩 Email recuerdo creado
    sendEmail(
      userEmail,
      "Este recuerdo ya existe",
      "recuerdo-creado.html",
      { CODIGO: recuerdoId }
    );

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR CREANDO RECUERDO:", err);
    res.status(500).json({ error: "Error creando recuerdo" });
  }
});

/* =========================
   GET /api/recuerdo/:id
   ========================= */
router.get("/recuerdo/:id", async (req, res) => {
  try {
    const recuerdo = await Recuerdo.findOne({ recuerdoId: req.params.id });

    if (!recuerdo) {
      return res.status(404).json({ error: "Recuerdo no encontrado" });
    }

    if (!recuerdo.pagado) {
      return res.json({ pagado: false });
    }

    res.json({
      pagado: true,
      qrUrl: recuerdo.qrUrl,
      audioUrl: recuerdo.audioUrl
    });

  } catch (err) {
    console.error("❌ ERROR OBTENIENDO RECUERDO:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

/* =========================
   GET /api/mis-recuerdos
   ========================= */
router.get("/mis-recuerdos", auth, async (req, res) => {
  try {
    const recuerdos = await Recuerdo.find({
      userEmail: req.user.email,
      pagado: true
    })
      .sort({ creadoEn: -1 })
      .select("nombre qrUrl audioUrl creadoEn recuerdoId");

    res.json(recuerdos);

  } catch (err) {
    console.error("❌ ERROR MIS RECUERDOS:", err);
    res.status(500).json({ error: "Error obteniendo recuerdos" });
  }
});

module.exports = router;
