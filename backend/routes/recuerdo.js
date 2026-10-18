const express = require("express");
const prisma = require("../db/prisma");
const auth = require("../middleware/auth");
const requireAuth = require("../middleware/requireAuth");
const { sendEmail } = require("../services/emailService.js");
const { isUuid } = require("../utils/validacion");
const { serializarRecuerdo, ordenarAudios } = require("../utils/serializers");
const { config } = require("../config/env");
const { rutaLocal, apartarArchivos } = require("../utils/archivos");

const router = express.Router();

/* =========================
   POST /api/recuerdo (flujo heredado) — DESHABILITADO
   Creaba recuerdos con pagado=true sin verificar ningún pago y con un audioUrl
   arbitrario. Ninguna pantalla lo usa: el flujo vigente es POST /api/upload.
   Se responde 410 para que un cliente viejo falle de forma explícita.
========================= */
router.post("/recuerdo", (req, res) => {
  res.status(410).json({ error: "Este endpoint ya no está disponible" });
});


// Evento Purchase del pixel en pago-exito.html: solo para un pago confirmado hace poco
// (Meta deduplica con la API de conversiones dentro de las 48 h) y con el importe cobrado.
// Visitar la página de una compra vieja no genera otra compra.
const VENTANA_COMPRA_MS = 24 * 3600 * 1000;

function compraReciente(recuerdo, ahora = Date.now()) {
  const pagadoEn = recuerdo.pagadoEn?.getTime();
  if (!pagadoEn || ahora - pagadoEn > VENTANA_COMPRA_MS || recuerdo.montoPagado == null) return {};
  return { compra: { valor: Number(recuerdo.montoPagado), moneda: recuerdo.moneda || "ARS" } };
}

/* =========================
   GET /api/recuerdo/:id
========================= */
router.get("/recuerdo/:id", async (req, res) => {
  try {
    const recuerdo = isUuid(req.params.id)
      ? await prisma.recuerdo.findUnique({
          where: { id: req.params.id },
          include: { audios: true }
        })
      : null;

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
      recuerdoId: recuerdo.id,
      nombre: recuerdo.nombre,
      pack: recuerdo.pack || "individual",
      audios: ordenarAudios(recuerdo.audios),
      qrUrl: recuerdo.qrUrl,
      creadoEn: recuerdo.createdAt,
      ...compraReciente(recuerdo)
    });

  } catch (err) {
    console.error("❌ ERROR OBTENIENDO RECUERDO:", err.message);
    res.status(500).json({ error: "Error interno" });
  }
});


/* =========================
   GET /api/mis-recuerdos
   🔥 INCLUYE EVENTOS
========================= */
router.get("/mis-recuerdos", auth, requireAuth, async (req, res) => {
  try {

    // 🔵 recuerdos normales
    const recuerdos = await prisma.recuerdo.findMany({
      where: { userId: req.user.id, pagado: true },
      orderBy: { createdAt: "desc" },
      include: { audios: true }
    });

    // 🟢 QRs de eventos del usuario con audio grabado (solo con el módulo habilitado)
    const qrs = !req.app.locals.eventsEnabled ? [] : await prisma.eventQr.findMany({
      where: {
        status: "completed",
        event: { userId: req.user.id }
      },
      orderBy: { createdAt: "asc" }
    });

    // 🔥 adaptar formato
    const eventosTransformados = qrs.map(q => ({
      _id: q.qrId,
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

    // 🔥 unir todo
    res.json([
      ...recuerdos.map(serializarRecuerdo),
      ...eventosTransformados
    ]);

  } catch (err) {
    console.error("❌ ERROR MIS RECUERDOS:", err.message);
    res.status(500).json({ error: "Error obteniendo recuerdos" });
  }
});


/* =========================
   PUT /api/recuerdos/:id
========================= */
router.put("/recuerdos/:id", auth, requireAuth, async (req, res) => {
  try {
    const nombre = typeof req.body.nombre === "string" ? req.body.nombre.trim() : "";

    if (nombre.length < 2 || nombre.length > 120) {
      return res.status(400).json({ error: "Nombre inválido" });
    }

    const recuerdo = isUuid(req.params.id)
      ? await prisma.recuerdo.findUnique({ where: { id: req.params.id } })
      : null;

    if (!recuerdo) {
      return res.status(404).json({ error: "Recuerdo no encontrado" });
    }

    if (recuerdo.userId !== req.user.id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const actualizado = await prisma.recuerdo.update({
      where: { id: recuerdo.id },
      data: { nombre }
    });

    res.json({ ok: true, nombre: actualizado.nombre });

  } catch (err) {
    console.error("❌ ERROR EDITANDO NOMBRE:", err.message);
    res.status(500).json({ error: "Error editando recuerdo" });
  }
});


/* =========================
   POST /api/recuerdos/:id/reenviar-mail
========================= */
router.post("/recuerdos/:id/reenviar-mail", auth, requireAuth, async (req, res) => {

  try {

    const recuerdo = isUuid(req.params.id)
      ? await prisma.recuerdo.findUnique({ where: { id: req.params.id } })
      : null;

    if (!recuerdo) {
      return res.status(404).json({
        error: "Recuerdo no encontrado"
      });
    }

    if (recuerdo.userId !== req.user.id) {
      return res.status(403).json({
        error: "No autorizado"
      });
    }

    if (!recuerdo.pagado) {
      return res.status(409).json({ error: "El recuerdo todavía no está pago" });
    }

    const linkRecuerdo =
      `${config.frontendUrl}/recuerdo.html?id=${recuerdo.id}`;

    await sendEmail(
      req.user.email,
      "Tu recuerdo ReQRdito 🎧",
      "recuerdo-creado.html",
      {
        CODIGO: recuerdo.id,
        LINK_RECUERDO: linkRecuerdo
      }
    );

    res.json({ ok: true });

  } catch (err) {

    console.error("❌ ERROR REENVIANDO MAIL:", err.message);

    res.status(500).json({
      error: "Error reenviando mail"
    });

  }

});

/* =========================
   DELETE /api/recuerdos/:id
   Recuerdo propio o QR de un evento propio
========================= */
router.delete("/recuerdos/:id", auth, requireAuth, async (req, res) => {
  try {

    const id = req.params.id;

    if (!isUuid(id)) {
      return res.status(404).json({ error: "No encontrado" });
    }

    // 🔥 1. recuerdo normal
    const recuerdo = await prisma.recuerdo.findUnique({ where: { id } });

    if (recuerdo) {

      if (recuerdo.userId !== req.user.id) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const audios = await prisma.recuerdoAudio.findMany({ where: { recuerdoId: id } });

      // audios en cascada; el llavero vinculado queda con recuerdo_id NULL (y usado)
      await prisma.recuerdo.delete({ where: { id } });

      // Después de confirmar el borrado, apartar SOLO archivos que ningún otro
      // registro use (uploads/eliminados/<id>/; no se eliminan del disco)
      const candidatos = [...audios.map(a => a.url), recuerdo.qrUrl].filter(Boolean);
      const enUso = await prisma.recuerdoAudio.findMany({
        where: { url: { in: candidatos } },
        select: { url: true }
      });
      const qrEnUso = recuerdo.qrUrl
        ? await prisma.recuerdo.count({ where: { qrUrl: recuerdo.qrUrl } })
        : 0;
      const usados = new Set(enUso.map(a => a.url));
      if (qrEnUso) usados.add(recuerdo.qrUrl);

      apartarArchivos(
        candidatos.filter(u => !usados.has(u)).map(rutaLocal),
        id
      );

      return res.json({ ok: true });
    }

    // 🔥 2. si no existe → QR de evento (solo con el módulo habilitado)
    if (!req.app.locals.eventsEnabled) {
      return res.status(404).json({ error: "No encontrado" });
    }

    const qr = await prisma.eventQr.findUnique({
      where: { qrId: id },
      include: { event: true }
    });

    if (!qr) {
      return res.status(404).json({ error: "No encontrado" });
    }

    if (qr.event.userId !== req.user.id) {
      return res.status(403).json({ error: "No autorizado" });
    }

    await prisma.eventQr.delete({ where: { qrId: id } });

    return res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR ELIMINANDO:", err.message);
    res.status(500).json({ error: "Error eliminando" });
  }
});

module.exports = router;
