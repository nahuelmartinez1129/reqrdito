const express = require("express");
const router = express.Router();
const prisma = require("../db/prisma");
const { serializarKeychain } = require("../utils/serializers");
const { config } = require("../config/env");
const { codigoLlaveroValido } = require("../utils/validacion");

// Llavero con el recuerdo vinculado y sus audios (para nombre y audioUrl)
function buscarKeychain(qrId) {
  if (!codigoLlaveroValido(qrId)) return Promise.resolve(null);
  return prisma.keychain.findUnique({
    where: { qrId },
    include: { recuerdo: { include: { audios: true } } }
  });
}


// =============================
// Verificar llavero (activar)
// =============================
router.get("/activar", async (req, res) => {

  try {

    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ error: "QR inválido" });
    }

    const keychain = await buscarKeychain(key);

    if (!keychain) {
      return res.status(404).json({ error: "Este llavero no existe" });
    }

    const datos = serializarKeychain(keychain);

    res.json({
      success: true,
      qrId: datos.qrId,
      usado: datos.usado,
      pack: datos.pack,
      recuerdoId: datos.recuerdoId,
      audioUrl: datos.audioUrl,
      nombreRecuerdo: datos.nombreRecuerdo
    });

  } catch (error) {

    console.error(error.message);
    res.status(500).json({ error: "Error del servidor" });

  }

});


// =============================
// Obtener datos del llavero
// =============================
router.get("/:key", async (req, res) => {

  try {

    const keychain = await buscarKeychain(req.params.key);

    if (!keychain) {
      return res.status(404).json({
        error: "Llavero no encontrado"
      });
    }

    res.json(serializarKeychain(keychain));

  } catch (error) {

    console.error(error.message);
    res.status(500).json({
      error: "Error del servidor"
    });

  }

});


// =============================
// Ruta inteligente del QR
// =============================
router.get("/r/:id", async (req, res) => {

  try {

    const { id } = req.params;

    if (!codigoLlaveroValido(id)) {
      return res.status(404).send("QR no existe");
    }

    // ✅ contar escaneos (incremento atómico)
    const { count } = await prisma.keychain.updateMany({
      where: { qrId: id },
      data: { escaneos: { increment: 1 } }
    });

    if (count === 0) {
      return res.status(404).send("QR no existe");
    }

    const keychain = await prisma.keychain.findUnique({ where: { qrId: id } });

    if (!keychain.usado) {
      return res.redirect(
        `${config.frontendUrl}/activar.html?key=${encodeURIComponent(id)}`
      );
    }

    // usado pero sin recuerdo: el dueño borró el recuerdo vinculado
    if (!keychain.recuerdoId) {
      return res.redirect(`${config.frontendUrl}/`);
    }

    return res.redirect(
      `${config.frontendUrl}/recuerdo.html?id=${keychain.recuerdoId}`
    );

  } catch (err) {

    console.error(err.message);
    res.status(500).send("Error servidor");

  }

});


module.exports = router;
