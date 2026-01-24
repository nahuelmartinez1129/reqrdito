const express = require("express");
const Recuerdo = require("../models/Recuerdo");
const auth = require("../middleware/auth");

const router = express.Router();

router.get("/mis-recuerdos", auth, async (req, res) => {
  try {
    const email = req.user.email;

    const recuerdos = await Recuerdo.find({
      userEmail: email,
      pagado: true
    }).sort({ creadoEn: -1 });

    res.json(recuerdos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo recuerdos" });
  }
});

module.exports = router;
