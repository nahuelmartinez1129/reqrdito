// Conciliación de pagos con Mercado Pago (para cuando el webhook no llegó).
//
// Busca en Mercado Pago los pagos de recuerdos con preferencia creada y todavía impagos,
// y los aprobados los procesa con procesarPago: cada pago se vuelve a consultar con
// Payment.get y se valida estado, importe, moneda y referencia. Nunca aprueba nada por
// su cuenta.
//
//   node scripts/conciliarPagos.js --local            → simulación sobre reqrdito_dev (.env.local)
//   node scripts/conciliarPagos.js --local --aplicar  → procesa los aprobados en reqrdito_dev
//   NODE_ENV=production node scripts/conciliarPagos.js [--aplicar]   → servidor de producción
//
// Opciones: --horas N (antigüedad máxima de la preferencia, 72 por defecto).
// Fuera de producción exige --local: así nunca toca la base principal local (reqrdito).
const args = process.argv.slice(2);
const local = args.includes("--local");
const aplicar = args.includes("--aplicar");
const iHoras = args.indexOf("--horas");
const horas = iHoras === -1 ? 72 : Number(args[iHoras + 1]);

if (local) {
  const { cargarEntornoLocal } = require("./lib/entornoLocal");
  try {
    const d = cargarEntornoLocal();
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

if (!Number.isFinite(horas) || horas <= 0) {
  console.error("✗ --horas debe ser un número positivo");
  process.exit(1);
}

const { Payment } = require("mercadopago");
const client = require("../config/mercadopago");
const prisma = require("../db/prisma");
const { conciliarPendientes } = require("../services/pagos");
const { credencialPermitida } = require("../services/mpCredencial");

(async () => {
  if (!(await credencialPermitida())) {
    throw new Error("La credencial de Mercado Pago no es de prueba y el entorno no es producción");
  }

  const resultados = await conciliarPendientes(new Payment(client), { aplicar, horas });
  console.log(aplicar ? "Modo: APLICAR" : "Modo: simulación (agregá --aplicar para procesar)");
  if (!resultados.length) console.log("No hay recuerdos impagos con preferencia en ese período.");
  for (const r of resultados) {
    console.log(`  recuerdo ${r.recuerdoId} · ${r.paymentId ? `pago ${r.paymentId} (${r.status}) · ` : ""}${r.resultado}`);
  }
})()
  .catch(err => { console.error("✗", err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
