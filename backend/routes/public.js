// LEGACY — NO MONTADO en app.js. Se conserva para no perder la referencia a
// data/recuerdos.json (4 registros históricos impagos, documentados en
// docs/DATOS_HISTORICOS.md). Los recuerdos se sirven desde PostgreSQL en
// routes/recuerdo.js. No montar este archivo.

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
