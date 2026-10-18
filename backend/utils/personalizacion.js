// Personalización opcional de un recuerdo (la foto se procesa aparte, en routes/upload.js).
const { normalizarCancion } = require("./cancion");

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Mensaje, fecha con contador y canción.
// Devuelve { datos } (listo para guardar) o { error } con el mensaje para la persona.
function personalizacion(body) {
  const texto = v => (typeof v === "string" ? v.trim() : "");
  const mensaje = texto(body.mensaje);
  const fechaTexto = texto(body.fecha);
  const fechaTitulo = texto(body.fechaTitulo);
  const cancionTexto = texto(body.cancion);

  if (mensaje.length > 600) return { error: "El mensaje es demasiado largo (máximo 600 caracteres)" };
  if (fechaTitulo.length > 60) return { error: "El título de la fecha es demasiado largo" };

  let fecha = null;
  if (fechaTexto) {
    const m = fechaTexto.match(FECHA_RE);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    // la fecha tiene que existir (sin 31 de febrero) y ser razonable
    if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1900 || +m[1] > 2100) {
      return { error: "La fecha no es válida" };
    }
    fecha = d;
  }

  let cancionUrl = null;
  if (cancionTexto) {
    cancionUrl = normalizarCancion(cancionTexto);
    if (!cancionUrl) return { error: "El link de la canción tiene que ser de Spotify o YouTube" };
  }

  return {
    datos: {
      mensaje: mensaje || null,
      fecha,
      fechaTitulo: fecha ? (fechaTitulo || "Desde") : null,
      cancionUrl
    }
  };
}

module.exports = { personalizacion };
