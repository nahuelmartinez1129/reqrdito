const express = require("express");
const router = express.Router();
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");

const prisma = require("../db/prisma");
const auth = require("../middleware/auth");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const { config } = require("../config/env");
const { enteroEnRango } = require("../utils/validacion");
const { generarCodigoLlavero } = require("../utils/codigos");

// Todo el panel exige sesión de un email incluido en ADMIN_EMAILS
router.use(auth, requireAuth, requireAdmin);

// La "tanda" a imprimir vive en la base (keychains.pendiente_impresion), no en
// memoria: sobrevive a reinicios y no se mezcla entre procesos.
const MAX_POR_TANDA = 500;

// Crea un llavero con código único; reintenta si el código ya existe
async function crearKeychain(pack) {
  for (let intento = 0; intento < 5; intento++) {
    const codigo = generarCodigoLlavero();
    try {
      await prisma.keychain.create({ data: { qrId: codigo, pack, pendienteImpresion: true } });
      return codigo;
    } catch (err) {
      if (err.code !== "P2002") throw err;
    }
  }
  throw new Error("No se pudo generar un código único");
}

function tanda() {
  return prisma.keychain.findMany({
    where: { pendienteImpresion: true },
    orderBy: [{ createdAt: "asc" }, { qrId: "asc" }],
    select: { qrId: true, pack: true }
  });
}

async function generar(req, res, pack) {
  try {

    const cantidad = enteroEnRango(req.body?.cantidad, 1, MAX_POR_TANDA);

    if (cantidad === null) {
      return res.status(400).json({ error: `Cantidad inválida (1 a ${MAX_POR_TANDA})` });
    }

    const pendientes = await prisma.keychain.count({ where: { pendienteImpresion: true } });

    if (pendientes + cantidad > MAX_POR_TANDA) {
      return res.status(400).json({ error: `La tanda no puede superar ${MAX_POR_TANDA} llaveros (hay ${pendientes})` });
    }

    for (let i = 0; i < cantidad; i++) {
      // 🔥 GUARDAR EN DB
      await crearKeychain(pack);
    }

    res.json({ total: pendientes + cantidad });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({
      error: pack === "pareja" ? "Error generando QR Dúo" : "Error generando QR individuales"
    });
  }
}

// ===============================
// GENERAR INDIVIDUALES
// ===============================
router.post("/generar-individuales", (req, res) => generar(req, res, "individual"));

// ===============================
// GENERAR PAREJA (Dúo)
// ===============================
router.post("/generar-pareja", (req, res) => generar(req, res, "pareja"));

// ===============================
// ESTADO DE LA TANDA
// ===============================
router.get("/tanda", async (req, res) => {
  try {
    const qrs = await tanda();
    res.json({ total: qrs.length, qrs: qrs.map(q => ({ codigo: q.qrId, tipo: q.pack })) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ===============================
// LIMPIAR (saca los llaveros de la tanda; no borra ningún llavero)
// ===============================
router.post("/limpiar", async (req, res) => {
  try {
    const { count } = await prisma.keychain.updateMany({
      where: { pendienteImpresion: true },
      data: { pendienteImpresion: false }
    });
    res.json({ ok: true, quitados: count });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// ===============================
// PDF FINAL (se genera en memoria y se envía directo: sin archivos compartidos)
// ===============================
router.get("/generar-pdf", async (req, res) => {

  let qrAcumulados;

  try {
    qrAcumulados = await tanda();
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: "Error del servidor" });
  }

  if (qrAcumulados.length === 0) {
    return res.status(400).json({ error: "No hay QR" });
  }

  // Los QR se generan antes de empezar a responder: si falla, todavía se puede enviar JSON
  let imagenes;
  try {
    imagenes = await Promise.all(
      qrAcumulados.map(qr => QRCode.toBuffer(`${config.apiUrl}/api/keychain/r/${qr.qrId}`))
    );
  } catch (err) {
    console.error("Error generando QR para PDF:", err.message);
    return res.status(500).json({ error: "Error generando PDF" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="llaveros-qr.pdf"');

  const doc = new PDFDocument({ size: "A4", margin: 0 });

  doc.on("error", (err) => {
    console.error("Error generando PDF:", err.message);
    res.destroy(err);
  });

  doc.pipe(res);

  // 📏 MEDIDAS EXACTAS
  const anchoTotal = 99;   // 3.5 cm
  const altoTotal = 128;   // 4.5 cm

  const margenQR = 18;
  const bordeNaranja = 3;

  const qrSize = anchoTotal - margenQR * 2;

  // 🔥 CENTRADO REAL
  const offsetX = (anchoTotal - qrSize) / 2;
  const offsetY = (altoTotal - qrSize) / 2;

  const espacioX = 12;
  const espacioY = 18;

  const margenX = 20;
  const margenY = 20;

  const porFila = Math.floor((595 - margenX) / (anchoTotal + espacioX));
  const porCol = Math.floor((842 - margenY) / (altoTotal + espacioY));
  const porPagina = porFila * porCol;

  let x = margenX;
  let y = margenY;

  for (let i = 0; i < qrAcumulados.length; i++) {

    if (i !== 0 && i % porPagina === 0) {
      doc.addPage();
      x = margenX;
      y = margenY;
    } else if (i % porFila === 0 && i !== 0) {
      y += altoTotal + espacioY;
      x = margenX;
    }

    const qrBuffer = imagenes[i];

    // 🟩 FONDO VERDE
    doc.rect(x, y, anchoTotal, altoTotal).fill("#6BAC73");

    // 🟧 BORDE NARANJA
    doc
      .rect(
        x + offsetX - bordeNaranja,
        y + offsetY - bordeNaranja,
        qrSize + bordeNaranja * 2,
        qrSize + bordeNaranja * 2
      )
      .fill("#EBAF2B");

    // ⬜ FONDO BLANCO
    doc
      .rect(
        x + offsetX,
        y + offsetY,
        qrSize,
        qrSize
      )
      .fill("#FFFFFF");

    // 🔥 QR
    doc.image(
      qrBuffer,
      x + offsetX,
      y + offsetY,
      {
        fit: [qrSize, qrSize],
      }
    );

    // ✂️ GUIA CORTE
    doc
      .lineWidth(0.3)
      .strokeColor("#aaaaaa")
      .rect(x, y, anchoTotal, altoTotal)
      .stroke();

    x += anchoTotal + espacioX;
  }

  doc.end();
});

module.exports = router;
