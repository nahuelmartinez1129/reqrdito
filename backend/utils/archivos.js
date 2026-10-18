// Rutas de archivos subidos, independientes del directorio de trabajo.
const fs = require("fs");
const path = require("path");

// UPLOADS_DIR permite separar los archivos del entorno de pruebas local (npm run dev)
const UPLOADS = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, "../uploads");
const DIRS = {
  temp: path.join(UPLOADS, "temp"),
  audio: path.join(UPLOADS, "audio"),
  qr: path.join(UPLOADS, "qr"),
  foto: path.join(UPLOADS, "foto"),
  // Archivos de recuerdos borrados: se apartan, no se eliminan
  eliminados: path.join(UPLOADS, "eliminados")
};

function borrarSiExiste(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error("No se pudo borrar archivo:", err.message);
  }
}

// Ruta local de una URL pública /audio/<archivo>, /qr/<archivo> o /foto/<archivo>; null si no corresponde
function rutaLocal(urlPublica) {
  if (typeof urlPublica !== "string") return null;
  const m = urlPublica.match(/^\/(audio|qr|foto)\/([A-Za-z0-9._-]+)$/);
  if (!m || m[2].startsWith(".")) return null;
  return path.join(DIRS[m[1]], m[2]);
}

// Mueve archivos a uploads/eliminados/<carpeta>/ sin sobrescribir nada existente
function apartarArchivos(rutas, carpeta) {
  const destinoDir = path.join(DIRS.eliminados, path.basename(carpeta));
  const movidos = [];

  for (const origen of rutas) {
    if (!origen || !fs.existsSync(origen)) continue;
    try {
      fs.mkdirSync(destinoDir, { recursive: true });
      let destino = path.join(destinoDir, path.basename(origen));
      if (fs.existsSync(destino)) destino += `.${Date.now()}`;
      fs.renameSync(origen, destino);
      movidos.push(destino);
    } catch (err) {
      console.error("No se pudo apartar archivo:", err.message);
    }
  }

  return movidos;
}

module.exports = { UPLOADS, DIRS, borrarSiExiste, rutaLocal, apartarArchivos };
