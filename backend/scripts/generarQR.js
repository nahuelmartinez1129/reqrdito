// Genera un PNG de QR por llavero en backend/qr-llaveros/ (carpeta ignorada por Git).
// Nunca sobrescribe un PNG existente: los QR ya generados/impresos se conservan.
//
// Los QR nuevos apuntan a la ruta inteligente de la API (cuenta escaneos y
// redirige a activar o al recuerdo). Los llaveros impresos con el formato
// anterior (https://reqrdito.com/activar?key=...) siguen funcionando.
require("dotenv").config({ quiet: true });

const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const prisma = require("../db/prisma");
const { config } = require("../config/env");

const DESTINO = path.join(__dirname, "../qr-llaveros");

async function generarQR() {

  fs.mkdirSync(DESTINO, { recursive: true });

  const keychains = await prisma.keychain.findMany({ select: { qrId: true } });

  let creados = 0;
  let omitidos = 0;

  for (const key of keychains) {

    const filePath = path.join(DESTINO, `${path.basename(key.qrId)}.png`);

    if (fs.existsSync(filePath)) {
      omitidos++;
      continue;
    }

    const url = `${config.apiUrl}/api/keychain/r/${encodeURIComponent(key.qrId)}`;

    await QRCode.toFile(filePath, url);
    creados++;

    console.log("QR creado:", key.qrId);

  }

  console.log(`QR creados: ${creados} · existentes conservados: ${omitidos}`);

}

generarQR()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
