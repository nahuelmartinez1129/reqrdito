const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();
const DATA_PATH = path.join(__dirname, "../data/recuerdos.json");

// Página pública del recuerdo
router.get("/r/:id", (req, res) => {
  const { id } = req.params;

  const recuerdos = JSON.parse(fs.readFileSync(DATA_PATH));
  const recuerdo = recuerdos.find(r => r.id === id);

  if (!recuerdo) {
    return res.status(404).send("Recuerdo no encontrado");
  }

  res.sendFile(path.join(__dirname, "../public/recuerdo.html"));
});

// Endpoint para obtener datos del recuerdo
router.get("/api/recuerdo/:id", (req, res) => {
  const { id } = req.params;

  const recuerdos = JSON.parse(fs.readFileSync(DATA_PATH));
  const recuerdo = recuerdos.find(r => r.id === id);

  if (!recuerdo) {
    return res.status(404).json({ error: "Recuerdo no encontrado" });
  }

  res.json({
    id: recuerdo.id,
    nombre: recuerdo.nombre,
    audio: `/uploads/audio/${recuerdo.archivo}`,
    estado: recuerdo.estado
  });
});

module.exports = router;
