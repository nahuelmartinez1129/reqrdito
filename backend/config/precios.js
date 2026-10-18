// Fuente única de verdad de los importes que cobra ReQRdito.
// El frontend los consulta en GET /api/precios; nunca envía un importe propio.
// `pareja` es el valor interno histórico del pack que se muestra como "Dúo".

const MONEDA = "ARS";

const PRECIOS = Object.freeze({
  individual: Object.freeze({ monto: 11990, moneda: MONEDA, nombre: "Individual", titulo: "Recuerdo QR – Individual" }),
  pareja: Object.freeze({ monto: 14990, moneda: MONEDA, nombre: "Dúo", titulo: "Recuerdo QR – Dúo" })
});

// Tarifas anteriores. Solo se aceptan para preferencias creadas antes de que el
// backend empezara a guardar `monto_esperado` (ver services/pagos.js).
// Dúo: 10.900 y después 21.990 (hasta el 2026-10-19, cuando pasó a 14.990).
const PRECIOS_ANTERIORES = Object.freeze({
  individual: Object.freeze([6900]),
  pareja: Object.freeze([10900, 21990])
});

// Precio oficial del pack (nunca el de prueba). Lo usa la validación de pagos
// históricos: un precio de prueba no debe servir para pagar recuerdos viejos.
function precioDe(pack) {
  return Object.prototype.hasOwnProperty.call(PRECIOS, pack) ? PRECIOS[pack] : null;
}

/* =========================
   Precio temporal de prueba (solo pack Individual, solo producción)
   PRECIO_PRUEBA_INDIVIDUAL_ARS=100
   PRECIO_PRUEBA_HASTA=2026-10-20T23:59:00-03:00   (ISO con zona horaria)
   PRECIO_PRUEBA_EMAILS=tu-cuenta@gmail.com        (dueños de recuerdo habilitados)
   Se aplica solo si NODE_ENV=production, el importe es un entero menor al oficial,
   la fecha de fin es futura y está a no más de PRUEBA_VENTANA_MAX_MS de ahora, y el
   dueño del recuerdo (sesión de Google) está en la lista. El resto paga el oficial.
   Al vencer vuelve solo al precio oficial; para cortarlo antes, borrar las tres
   variables del .env y reiniciar el proceso.
========================= */
const PACK_PRUEBA = "individual";
const PRUEBA_VENTANA_MAX_MS = 72 * 60 * 60 * 1000;

// Devuelve { activo, monto?, hasta?, motivo? }. No lanza: una configuración inválida
// deja el precio oficial.
function estadoPrecioPrueba(env = process.env, ahora = new Date()) {
  const montoTexto = env.PRECIO_PRUEBA_INDIVIDUAL_ARS;
  const hastaTexto = env.PRECIO_PRUEBA_HASTA;
  if (!montoTexto && !hastaTexto && !env.PRECIO_PRUEBA_EMAILS) return { activo: false, motivo: "sin_configurar" };

  if (env.NODE_ENV !== "production") return { activo: false, motivo: "fuera_de_produccion" };

  const oficial = PRECIOS[PACK_PRUEBA].monto;
  if (!/^\d+$/.test(String(montoTexto || "").trim())) return { activo: false, motivo: "monto_invalido" };
  const monto = Number(montoTexto);
  if (monto < 1 || monto >= oficial) return { activo: false, motivo: "monto_invalido" };

  // Exige zona horaria explícita para no depender de la del servidor
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(String(hastaTexto || "").trim())) {
    return { activo: false, motivo: "fecha_invalida" };
  }
  const hasta = new Date(hastaTexto);
  if (Number.isNaN(hasta.getTime())) return { activo: false, motivo: "fecha_invalida" };
  if (hasta <= ahora) return { activo: false, motivo: "vencido", hasta };
  if (hasta - ahora > PRUEBA_VENTANA_MAX_MS) return { activo: false, motivo: "ventana_demasiado_larga", hasta };

  const emails = String(env.PRECIO_PRUEBA_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length || emails.some(e => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) {
    return { activo: false, motivo: "emails_invalidos" };
  }

  return { activo: true, monto, hasta, hastaIso: String(hastaTexto).trim(), emails };
}

// Precio que se cobra HOY por el pack a este dueño de recuerdo: el oficial, salvo el de
// prueba vigente del Individual si `email` está habilitado. Incluye `prueba` y `hasta`
// cuando corresponde, para expirar la preferencia y registrarlo.
function precioACobrar(pack, email, env = process.env, ahora = new Date()) {
  const oficial = precioDe(pack);
  if (!oficial || pack !== PACK_PRUEBA) return oficial;

  const prueba = estadoPrecioPrueba(env, ahora);
  if (!prueba.activo) return oficial;
  if (!email || !prueba.emails.includes(String(email).trim().toLowerCase())) return oficial;

  return Object.freeze({ ...oficial, monto: prueba.monto, prueba: true, hasta: prueba.hasta, hastaIso: prueba.hastaIso });
}

module.exports = {
  MONEDA, PRECIOS, PRECIOS_ANTERIORES, PRUEBA_VENTANA_MAX_MS,
  precioDe, precioACobrar, estadoPrecioPrueba
};
