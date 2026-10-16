const express = require("express");
const Recuerdo = require("../models/Recuerdo");
const Keychain = require("../models/Keychain");
const QR = require("../events/models/QR");
const auth = require("../middleware/auth");
const { sendEmail } = require("../services/emailService.js");

const router = express.Router();


router.post("/recuerdo", auth, async (req, res) => {

  try {
    console.log("BODY RECIBIDO:", req.body);

    const { nombre, qrUrl, audioUrl, recuerdoId, key } = req.body;
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

    // 🔑 ACTUALIZAR LLAVERO
    if (key) {

      const keychain = await Keychain.findOne({ qrId: key });

      if (keychain) {

        keychain.usado = true;
        keychain.audioUrl = audioUrl;
        keychain.recuerdoId = recuerdoId;
        keychain.nombreRecuerdo = nombre;
        keychain.activadoEn = new Date();

        await keychain.save();
      }
    }

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
      return res.json({
        pagado: false,
        pack: recuerdo.pack || "individual"
      });
    }

    res.json({
      pagado: true,
      recuerdoId: recuerdo.recuerdoId,
      nombre: recuerdo.nombre,
      pack: recuerdo.pack || "individual",
      audios: recuerdo.audios || [],
      audioUrl: recuerdo.audioUrl,
      qrUrl: recuerdo.qrUrl,
      creadoEn: recuerdo.creadoEn
    });

  } catch (err) {
    console.error("❌ ERROR OBTENIENDO RECUERDO:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


/* =========================
   GET /api/mis-recuerdos
   🔥 MODIFICADO (INCLUYE EVENTOS)
========================= */
router.get("/mis-recuerdos", auth, async (req, res) => {
  try {
    const userEmail = req.user.email;

    // 🔵 recuerdos normales
    const recuerdos = await Recuerdo.find({
      userEmail,
      pagado: true
    })
      .sort({ creadoEn: -1 })
      .select("nombre qrUrl audioUrl audios pack creadoEn recuerdoId");

    // 🔍 obtener usuario
    const User = require("../models/User");
    const user = await User.findOne({ email: userEmail });

    let eventosTransformados = [];

    if (user) {

      // 🟢 QRs de eventos
      const qrs = await QR.find({
        userId: user._id,
        status: "completed"
      });

      // 🔥 adaptar formato
        eventosTransformados = qrs.map(q => ({
  _id: q._id,
  recuerdoId: q.qrId,
  nombre: q.name,
  creadoEn: q.createdAt,

  audios: [
    {
      url: q.audioUrl,
      orden: 1
    }
  ],
  qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://api.reqrdito.com/events/r/${q.qrId}`,
  pack: "evento"
}));

    }

    // 🔥 unir todo
    const resultado = [
      ...recuerdos,
      ...eventosTransformados
    ];

    res.json(resultado);

  } catch (err) {
    console.error("❌ ERROR MIS RECUERDOS:", err);
    res.status(500).json({ error: "Error obteniendo recuerdos" });
  }
});


/* =========================
   PUT /api/recuerdos/:id
========================= */
router.put("/recuerdos/:id", auth, async (req, res) => {
  try {
    const { nombre } = req.body;

    if (!nombre || nombre.trim().length < 2) {
      return res.status(400).json({ error: "Nombre inválido" });
    }

    const recuerdo = await Recuerdo.findById(req.params.id);

    if (!recuerdo) {
      return res.status(404).json({ error: "Recuerdo no encontrado" });
    }

    if (recuerdo.userEmail !== req.user.email) {
      return res.status(403).json({ error: "No autorizado" });
    }

    recuerdo.nombre = nombre.trim();
    await recuerdo.save();

    res.json({ ok: true, nombre: recuerdo.nombre });

  } catch (err) {
    console.error("❌ ERROR EDITANDO NOMBRE:", err);
    res.status(500).json({ error: "Error editando recuerdo" });
  }
});


/* =========================
   POST /api/recuerdos/:id/reenviar-mail
========================= */
router.post("/recuerdos/:id/reenviar-mail", auth, async (req, res) => {

  try {

    const recuerdo = await Recuerdo.findOne({
      recuerdoId: req.params.id
    });

    if (!recuerdo) {
      return res.status(404).json({
        error: "Recuerdo no encontrado"
      });
    }

    if (recuerdo.userEmail !== req.user.email) {
      return res.status(403).json({
        error: "No autorizado"
      });
    }

    const linkRecuerdo =
      `https://www.reqrdito.com/recuerdo.html?id=${recuerdo.recuerdoId}`;

    await sendEmail(
      req.user.email,
      "Tu recuerdo ReQRdito 🎧",
      "recuerdo-creado.html",
      {
        CODIGO: recuerdo.recuerdoId,
        LINK_RECUERDO: linkRecuerdo
      }
    );

    console.log("✅ MAIL REENVIADO A:", req.user.email);

    res.json({ ok: true });

  } catch (err) {

    console.error("❌ ERROR REENVIANDO MAIL:", err);

    res.status(500).json({
      error: "Error reenviando mail"
    });

  }

});

/* =========================
   DELETE /api/recuerdos/:id (FIX FINAL 🔥)
========================= */
router.delete("/recuerdos/:id", auth, async (req, res) => {
  try {

    const id = req.params.id;

    console.log("🧪 ID RECIBIDO:", id);

    // 🔥 1. intentar borrar recuerdo normal (por recuerdoId)
    const recuerdo = await Recuerdo.findOne({ recuerdoId: id });

    if (recuerdo) {

      if (recuerdo.userEmail !== req.user.email) {
        return res.status(403).json({ error: "No autorizado" });
      }

      await Recuerdo.deleteOne({ recuerdoId: id });

      console.log("✅ Recuerdo eliminado");

      return res.json({ ok: true });
    }

    // 🔥 2. si no existe → buscar QR (evento)
    const qr = await QR.findOne({ qrId: id });

    if (!qr) {
      console.log("❌ No encontrado en QR");
      return res.status(404).json({ error: "No encontrado" });
    }

    await QR.deleteOne({ qrId: id });

    console.log("✅ QR eliminado");

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR ELIMINANDO:", err);
    res.status(500).json({ error: "Error eliminando" });
  }
});

module.exports = router;
