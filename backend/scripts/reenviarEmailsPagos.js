// Reintenta los emails de pago confirmado que quedaron pendientes
// (recuerdo pagado con payment_id y email_pago_enviado_en NULL).
//
// Uso:  node scripts/reenviarEmailsPagos.js            → lista pendientes (no envía)
//       node scripts/reenviarEmailsPagos.js --enviar   → los envía (requiere emails habilitados)
// Pensado para correr a mano o por cron en el VPS; nunca envía dos veces el mismo email
// porque usa el mismo bloqueo que el webhook.
// En la PC: agregar --local (base reqrdito_dev de .env.local). Fuera de producción y sin
// --local se niega a correr, para no tocar la base principal local (reqrdito).
if (process.argv.includes("--local")) {
  try {
    const d = require("./lib/entornoLocal").cargarEntornoLocal();
    console.log(`Entorno LOCAL · base ${d.base} en ${d.host}:${d.puerto}`);
  } catch (err) {
    console.error("✗", err.message);
    process.exit(1);
  }
} else {
  require("dotenv").config({ quiet: true });
  if (process.env.NODE_ENV !== "production") {
    console.error("✗ Fuera de producción usá --local (base reqrdito_dev). No se toca la base principal.");
    process.exit(1);
  }
}

const prisma = require("../db/prisma");
const { enviarEmailPendiente } = require("../services/pagos");

async function main() {
  const pendientes = await prisma.recuerdo.findMany({
    where: { pagado: true, paymentId: { not: null }, emailPagoEnviadoEn: null },
    select: { id: true, pagadoEn: true, emailPagoIntentos: true },
    orderBy: { pagadoEn: "asc" }
  });

  console.log(`Emails de pago pendientes: ${pendientes.length}`);
  for (const p of pendientes) {
    console.log(`  ${p.id} · pagado ${p.pagadoEn?.toISOString() ?? "?"} · intentos ${p.emailPagoIntentos}`);
  }

  if (!process.argv.includes("--enviar")) {
    if (pendientes.length) console.log("Agregá --enviar para enviarlos.");
    return;
  }

  const resumen = {};
  for (const p of pendientes) {
    try {
      const r = await enviarEmailPendiente(p.id);
      resumen[r] = (resumen[r] || 0) + 1;
    } catch (err) {
      resumen.error = (resumen.error || 0) + 1;
      console.error(`  ✗ ${p.id}: ${err.message}`);
    }
  }
  console.log("Resultado:", resumen);
  if (resumen.error) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
