// Aplicación de pagos de Mercado Pago a recuerdos.
//
// Reglas:
// - El estado, importe, moneda y referencia salen SIEMPRE de Payment.get (API de
//   Mercado Pago), nunca del body del webhook ni del navegador.
// - El importe esperado es el que se fijó al crear la preferencia
//   (recuerdos.monto_esperado). Preferencias creadas antes de ese campo aceptan
//   la tarifa anterior o la vigente del pack, y quedan registradas para revisión.
// - Un pago aprobado que no coincide no marca nada como pagado: se registra en
//   pagos_revision (idempotente por payment_id + motivo).
// - El email de pago es durable: se marca enviado solo al confirmarse el envío,
//   y un reintento del webhook (o scripts/reenviarEmailsPagos.js) lo completa.

const prisma = require("../db/prisma");
const enviarEmail = require("../utils/enviarEmail");
const { isUuid } = require("../utils/validacion");
const { MONEDA, precioDe, PRECIOS_ANTERIORES } = require("../config/precios");

const PREFIJO_REFERENCIA = "REQRDITO_";
// Un intento de envío "en curso" se considera abandonado después de este tiempo
const BLOQUEO_EMAIL_MS = 5 * 60 * 1000;

function mismoImporte(a, b) {
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

// Para los registros: "ana@example.com" → "a***@example.com" (sin datos personales completos)
function enmascararEmail(email) {
  const [usuario, dominio] = String(email || "").split("@");
  return dominio ? `${usuario.slice(0, 1)}***@${dominio}` : "(sin email)";
}

async function registrarRevision(datos) {
  try {
    await prisma.pagoRevision.upsert({
      where: { paymentId_motivo: { paymentId: datos.paymentId, motivo: datos.motivo } },
      update: {},
      create: datos
    });
  } catch (err) {
    console.error("No se pudo registrar el pago para revisión:", err.message);
    throw err;
  }
  console.warn(`⚠️ Pago ${datos.paymentId} enviado a revisión: ${datos.motivo}`);
}

// Importes aceptables para este recuerdo. `legacy` indica que no había importe registrado.
function importesEsperados(recuerdo) {
  if (recuerdo.montoEsperado != null) {
    return { importes: [recuerdo.montoEsperado], moneda: recuerdo.moneda || MONEDA, legacy: false };
  }

  const actual = precioDe(recuerdo.pack);
  const anterior = PRECIOS_ANTERIORES[recuerdo.pack];
  return {
    importes: [anterior, actual?.monto].filter(Boolean),
    moneda: MONEDA,
    legacy: true
  };
}

/**
 * Procesa un pago por id.
 * @param {string} origen - quién lo pide (webhook, conciliacion...), solo para los registros
 * @returns {Promise<{resultado: string, recuerdoId?: string}>}
 * Lanza error solo cuando conviene que Mercado Pago reintente
 * (falla de su API, de la base o del envío del email).
 */
async function procesarPago(paymentId, paymentApi, { origen = "webhook" } = {}) {
  const diag = {};
  try {
    const r = await aplicarPago(String(paymentId), paymentApi, diag);
    // Registro de diagnóstico: ids, estado y resultado; nunca tokens ni datos del pagador
    const detalle = [diag.status && `estado=${diag.status}`, diag.statusDetail && `detalle=${diag.statusDetail}`,
      r.recuerdoId && `recuerdo=${r.recuerdoId}`].filter(Boolean).join(" ");
    console.log(`💳 Pago ${String(paymentId).slice(0, 30)} [${origen}] → ${r.resultado}${detalle ? " · " + detalle : ""}`);
    return r;
  } catch (err) {
    console.error(`❌ Pago ${String(paymentId).slice(0, 30)} [${origen}] → error: ${err.message}`);
    throw err;
  }
}

async function aplicarPago(id, paymentApi, diag) {
  if (!/^[0-9]{1,30}$/.test(id)) {
    return { resultado: "id_invalido" };
  }

  const info = await paymentApi.get({ id });
  diag.status = typeof info.status === "string" ? info.status.slice(0, 30) : null;
  diag.statusDetail = typeof info.status_detail === "string" ? info.status_detail.slice(0, 60) : null;

  const externalRef = typeof info.external_reference === "string" ? info.external_reference : "";

  // Pagos de otras integraciones de la misma cuenta: no son de ReQRdito
  if (!externalRef.startsWith(PREFIJO_REFERENCIA)) {
    return { resultado: "referencia_ajena" };
  }

  if (info.status !== "approved") {
    return { resultado: "no_aprobado" };
  }

  const recuerdoId = externalRef.slice(PREFIJO_REFERENCIA.length);
  const base = {
    paymentId: id,
    status: info.status,
    monto: info.transaction_amount ?? null,
    moneda: typeof info.currency_id === "string" ? info.currency_id.slice(0, 3) : null,
    externalReference: externalRef.slice(0, 128)
  };

  if (!isUuid(recuerdoId)) {
    await registrarRevision({ ...base, motivo: "referencia_invalida" });
    return { resultado: "revision" };
  }

  const recuerdo = await prisma.recuerdo.findUnique({ where: { id: recuerdoId } });

  if (!recuerdo) {
    await registrarRevision({ ...base, motivo: "recuerdo_inexistente" });
    return { resultado: "revision" };
  }

  base.recuerdoId = recuerdo.id;

  if (recuerdo.pagado) {
    if (recuerdo.paymentId === id) {
      // Webhook repetido: solo falta, quizás, el email
      await enviarEmailPendiente(recuerdo.id);
      return { resultado: "duplicado", recuerdoId: recuerdo.id };
    }
    await registrarRevision({ ...base, motivo: "pago_duplicado", montoEsperado: recuerdo.montoEsperado });
    return { resultado: "revision", recuerdoId: recuerdo.id };
  }

  const esperado = importesEsperados(recuerdo);
  base.montoEsperado = esperado.legacy ? null : esperado.importes[0];

  if (base.moneda !== esperado.moneda) {
    await registrarRevision({ ...base, motivo: "moneda_incorrecta" });
    return { resultado: "revision", recuerdoId: recuerdo.id };
  }

  const montoPagado = Number(info.transaction_amount);

  if (!Number.isFinite(montoPagado) || !esperado.importes.some(m => mismoImporte(m, montoPagado))) {
    await registrarRevision({ ...base, motivo: "importe_incorrecto" });
    return { resultado: "revision", recuerdoId: recuerdo.id };
  }

  try {
    // ✅ Marcar pago solo si todavía no estaba pago (idempotente ante webhooks simultáneos)
    const { count } = await prisma.recuerdo.updateMany({
      where: { id: recuerdo.id, pagado: false },
      data: {
        pagado: true,
        paymentId: id,
        payerEmail: typeof info.payer?.email === "string" ? info.payer.email.slice(0, 320) : null,
        pagadoEn: new Date(),
        montoPagado,
        moneda: esperado.moneda
      }
    });

    if (count === 0) {
      // Otro webhook lo marcó en paralelo: reevaluar desde el estado actual
      return aplicarPago(id, paymentApi, diag);
    }
  } catch (err) {
    if (err.code === "P2002") {
      await registrarRevision({ ...base, motivo: "payment_id_en_otro_recuerdo" });
      return { resultado: "revision", recuerdoId: recuerdo.id };
    }
    throw err;
  }

  if (esperado.legacy) {
    // Pagado correctamente, pero sin importe registrado en la preferencia: queda a la vista
    await registrarRevision({ ...base, motivo: "sin_monto_registrado" });
  }

  console.log("🟢 Pago confirmado:", recuerdo.id);

  await enviarEmailPendiente(recuerdo.id);

  return { resultado: "pagado", recuerdoId: recuerdo.id };
}

/**
 * Envía el email de pago confirmado si todavía no se envió.
 * Toma un "bloqueo" en la base para que dos webhooks simultáneos no lo dupliquen.
 * Lanza error si el envío falla (el email queda pendiente).
 * @returns {Promise<"enviado"|"ya_enviado"|"en_curso"|"simulado">}
 */
async function enviarEmailPendiente(recuerdoId) {
  const ahora = new Date();

  const { count } = await prisma.recuerdo.updateMany({
    where: {
      id: recuerdoId,
      pagado: true,
      emailPagoEnviadoEn: null,
      OR: [
        { emailPagoIntentoEn: null },
        { emailPagoIntentoEn: { lt: new Date(ahora.getTime() - BLOQUEO_EMAIL_MS) } }
      ]
    },
    data: { emailPagoIntentoEn: ahora, emailPagoIntentos: { increment: 1 } }
  });

  if (count === 0) {
    const r = await prisma.recuerdo.findUnique({ where: { id: recuerdoId }, select: { emailPagoEnviadoEn: true } });
    return r?.emailPagoEnviadoEn ? "ya_enviado" : "en_curso";
  }

  const recuerdo = await prisma.recuerdo.findUnique({
    where: { id: recuerdoId },
    include: { user: true }
  });

  let resultado;
  // destinatario: el dueño del recuerdo (cuenta de Google), no el pagador de Mercado Pago
  const destino = enmascararEmail(recuerdo.user.email);

  try {
    resultado = await enviarEmail(recuerdo.user.email, recuerdo.id);
  } catch (err) {
    // Liberar el bloqueo para que el próximo reintento lo vuelva a intentar
    await prisma.recuerdo.update({ where: { id: recuerdoId }, data: { emailPagoIntentoEn: null } });
    console.error(`✉️ Email de pago ${recuerdoId} → ${destino}: error (${err.message})`);
    throw new Error(`Email de pago pendiente (${recuerdoId}): ${err.message}`);
  }

  if (resultado && resultado.simulado) {
    // Emails deshabilitados (entorno local): queda pendiente, no se da por enviado
    await prisma.recuerdo.update({ where: { id: recuerdoId }, data: { emailPagoIntentoEn: null } });
    console.log(`✉️ Email de pago ${recuerdoId} → ${destino}: simulado (EMAIL_ENABLED desactivado), queda pendiente`);
    return "simulado";
  }

  await prisma.recuerdo.update({
    where: { id: recuerdoId },
    data: { emailPagoEnviadoEn: new Date() }
  });

  console.log(`✉️ Email de pago ${recuerdoId} → ${destino}: enviado`);
  return "enviado";
}

/**
 * Conciliación: para recuerdos con preferencia creada y todavía impagos, busca en
 * Mercado Pago sus pagos (por external_reference) y pasa los aprobados por
 * procesarPago, que vuelve a consultar cada pago con Payment.get y aplica todas las
 * validaciones. Sirve cuando el webhook no llega (entorno local sin túnel, caídas).
 * La búsqueda solo descubre ids: nunca se usa como fuente de verdad.
 * @param {object} paymentApi - instancia de Payment (get y search)
 * @param {{aplicar?: boolean, horas?: number, limite?: number}} opciones
 * @returns {Promise<Array<{recuerdoId: string, paymentId?: string, status?: string, resultado: string}>>}
 */
async function conciliarPendientes(paymentApi, { aplicar = false, horas = 72, limite = 50 } = {}) {
  const pendientes = await prisma.recuerdo.findMany({
    where: {
      pagado: false,
      preferenciaId: { not: null },
      preferenciaCreadaEn: { gte: new Date(Date.now() - horas * 3600 * 1000) }
    },
    select: { id: true },
    orderBy: { preferenciaCreadaEn: "desc" },
    take: limite
  });

  const resultados = [];

  for (const { id: recuerdoId } of pendientes) {
    const referencia = `${PREFIJO_REFERENCIA}${recuerdoId}`;
    const busqueda = await paymentApi.search({
      options: { external_reference: referencia, sort: "date_created", criteria: "desc" }
    });
    const pagos = (busqueda?.results || []).filter(p => p.external_reference === referencia && p.id != null);

    if (!pagos.length) {
      resultados.push({ recuerdoId, resultado: "sin_pagos" });
      continue;
    }

    // pagos que ya quedaron para revisión manual no se reprocesan en cada vuelta
    const enRevision = new Set((await prisma.pagoRevision.findMany({
      where: { paymentId: { in: pagos.map(p => String(p.id)) } },
      select: { paymentId: true }
    })).map(x => x.paymentId));

    for (const p of pagos) {
      const paymentId = String(p.id);
      if (enRevision.has(paymentId)) {
        resultados.push({ recuerdoId, paymentId, status: p.status, resultado: "en_revision" });
        continue;
      }
      if (p.status !== "approved") {
        resultados.push({ recuerdoId, paymentId, status: p.status, resultado: "no_aprobado" });
        continue;
      }
      if (!aplicar) {
        resultados.push({ recuerdoId, paymentId, status: p.status, resultado: "a_procesar" });
        continue;
      }
      const r = await procesarPago(paymentId, paymentApi, { origen: "conciliacion" });
      resultados.push({ recuerdoId, paymentId, status: p.status, resultado: r.resultado });
    }
  }

  return resultados;
}

module.exports = { procesarPago, enviarEmailPendiente, conciliarPendientes, importesEsperados, enmascararEmail, PREFIJO_REFERENCIA };
