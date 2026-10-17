// Crea llaveros nuevos en la base configurada en DATABASE_URL.
// Uso: node scripts/generarKeychains.js --cantidad 100 [--pack individual|pareja] --si
// Sin --si solo muestra lo que haría (evita altas accidentales en producción).
require("dotenv").config({ quiet: true });

const prisma = require("../db/prisma");
const { generarCodigoLlavero } = require("../utils/codigos");
const { enteroEnRango, PACKS } = require("../utils/validacion");

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function generarKeychains() {

  const cantidad = enteroEnRango(arg("cantidad") ?? 100, 1, 1000);
  const pack = arg("pack") ?? "individual";

  if (cantidad === null || !PACKS.includes(pack)) {
    throw new Error("Uso: --cantidad 1..1000 --pack individual|pareja --si");
  }

  if (!process.argv.includes("--si")) {
    console.log(`Simulación: se crearían ${cantidad} llaveros "${pack}". Agregá --si para crearlos.`);
    return;
  }

  let creados = 0;

  while (creados < cantidad) {

    const qrId = generarCodigoLlavero("KEY", 6);

    try {
      await prisma.keychain.create({ data: { qrId, pack } });
      creados++;
      console.log("Creado:", qrId);
    } catch (err) {
      if (err.code !== "P2002") throw err;
      console.log("Código repetido, se reintenta:", qrId);
    }

  }

  console.log(`Llaveros generados: ${creados}`);

}

generarKeychains()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
