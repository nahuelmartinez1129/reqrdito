const express = require("express");
const path = require("path");
const { DIRS } = require("../utils/archivos");
const prisma = require("../db/prisma");
const { isUuid } = require("../utils/validacion");

const router = express.Router();

router.get("/descargar-qr/:id", async (req, res) => {
  try {
    const recuerdo = isUuid(req.params.id)
      ? await prisma.recuerdo.findUnique({ where: { id: req.params.id } })
      : null;

    if (!recuerdo || !recuerdo.qrUrl) {
      return res.status(404).send("QR no encontrado");
    }

    const qrPath = path.join(DIRS.qr, path.basename(recuerdo.qrUrl));

    res.download(qrPath, `recuerdo-${req.params.id}.png`, (err) => {
      if (err && !res.headersSent) res.status(404).send("QR no encontrado");
    });
  } catch (err) {
    console.error("ERROR DESCARGANDO QR:", err.message);
    res.status(500).send("Error descargando QR");
  }
});

module.exports = router;
