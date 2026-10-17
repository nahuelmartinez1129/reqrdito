require("dotenv").config({ quiet: true });

const { validarEntorno } = require("./config/env");

const { errores, avisos } = validarEntorno();

for (const aviso of avisos) console.warn("⚠️", aviso);

if (errores.length) {
  for (const error of errores) console.error("🔴", error);
  process.exit(1);
}

const prisma = require("./db/prisma");
const app = require("./app");

const PORT = Number(process.env.PORT) || 5000;

async function iniciar() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("🟢 PostgreSQL conectado");
  } catch (err) {
    console.error("🔴 Error conectando a PostgreSQL:", err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log("🚀 Backend escuchando en puerto", PORT);
  });

  // PM2 envía SIGINT al reiniciar: cerrar HTTP y la conexión a la base
  const cerrar = (signal) => {
    console.log(`Recibido ${signal}, cerrando...`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
}

iniciar();
