const express = require("express");
const path = require("path");
const Recuerdo = require("../models/Recuerdo");

const router = express.Router();

router.get("/descargar-qr/:id", async (req, res) => {
  try {
    const recuerdo = await Recuerdo.findOne({ recuerdoId: req.params.id });

    if (!recuerdo || !recuerdo.qrUrl) {
      return res.status(404).send("QR no encontrado");
    }

    const qrPath = path.join(
      __dirname,
      "..",
      "uploads",
      "qr",
      path.basename(recuerdo.qrUrl)
    );

    res.download(qrPath, `recuerdo-${req.params.id}.png`);
  } catch (err) {
    console.error("ERROR DESCARGANDO QR:", err);
    res.status(500).send("Error descargando QR");
  }
});

module.exports = router;
