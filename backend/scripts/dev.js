// Entorno de pruebas local: backend (puerto PORT, 5000) + frontend estático (FRONT_PORT, 5500)
// con la base reqrdito_dev y los archivos en UPLOADS_DIR. Ver docs/PRUEBAS_LOCALES.md.
//   npm run dev
const http = require("http");
const fs = require("fs");
const path = require("path");
const { cargarEntornoLocal, RAIZ } = require("./lib/entornoLocal");

let destino;
try {
  destino = cargarEntornoLocal();
} catch (err) {
  console.error("✗", err.message);
  process.exit(1);
}

console.log(`🧪 Entorno LOCAL · base ${destino.base} en ${destino.host}:${destino.puerto} (usuario ${destino.usuario})`);
console.log(`   archivos: ${process.env.UPLOADS_DIR ? path.resolve(RAIZ, process.env.UPLOADS_DIR) : "uploads/ (sin UPLOADS_DIR)"}`);

// Las subidas convierten los audios a MP3 con ffmpeg (FFMPEG_PATH o el ffmpeg del PATH)
const ffmpeg = require("child_process").spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpeg.status === 0) {
  console.log(`   ${ffmpeg.stdout.split("\n")[0].split(" Copyright")[0]}`);
} else {
  console.warn("⚠️ ffmpeg no encontrado: las subidas de audio van a fallar. Instalalo (winget install Gyan.FFmpeg)");
  console.warn("   y reabrí la terminal, o indicá la ruta con FFMPEG_PATH en .env.local");
}

/* ---------- Frontend estático ---------- */
const FRONT = path.resolve(RAIZ, "../frontend");
const FRONT_PORT = Number(process.env.FRONT_PORT) || 5500;
const TIPOS = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".map": "application/json", ".webp": "image/webp"
};

http.createServer((req, res) => {
  let ruta;
  try {
    ruta = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400); return res.end();
  }
  if (ruta === "/") ruta = "/index.html";
  // /activar?key= (formato de llaveros impresos) → activar.html, como debería resolver nginx
  if (ruta === "/activar") ruta = "/activar.html";

  const archivo = path.join(FRONT, ruta);
  if (!archivo.startsWith(FRONT + path.sep) || ruta.split("/").some(p => p.startsWith(".")) ||
      !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("No encontrado");
  }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(archivo).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(archivo).pipe(res);
}).on("error", (err) => {
  // p. ej. Live Server de VS Code ocupando el puerto: el backend sigue, pero conviene cerrarlo
  console.error(`✗ Frontend no disponible en el puerto ${FRONT_PORT}: ${err.code || err.message}. ` +
    "Cerrá Live Server (u otro servidor en ese puerto) o cambiá FRONT_PORT y FRONTEND_URL en .env.local");
}).listen(FRONT_PORT, "127.0.0.1", () => {
  console.log(`🌐 Frontend: http://localhost:${FRONT_PORT} (si VS Code Live Server usa el mismo puerto, cerralo)`);
});

/* ---------- Backend ---------- */
require(path.join(RAIZ, "server.js"));

/* ---------- Conciliación de pagos ----------
   Sin túnel (MP_NOTIFICATION_URL), Mercado Pago no puede notificar a localhost y con
   URLs http:// tampoco acepta auto_return. Para que un pago aprobado active el recuerdo
   aunque no se vuelva al sitio, cada 20 s se buscan en Mercado Pago los pagos de las
   preferencias impagas y se procesan con procesarPago (consulta y valida cada pago). */
if (!process.env.MP_NOTIFICATION_URL) {
  const { Payment } = require("mercadopago");
  const client = require(path.join(RAIZ, "config/mercadopago"));
  const { conciliarPendientes } = require(path.join(RAIZ, "services/pagos"));
  const { credencialPermitida } = require(path.join(RAIZ, "services/mpCredencial"));
  const payment = new Payment(client);
  let ultimoError = null;

  const conciliar = async () => {
    try {
      if (!(await credencialPermitida())) return; // credencial real: no se consulta nada
      await conciliarPendientes(payment, { aplicar: true, horas: 24 }); // procesarPago registra cada pago
      ultimoError = null;
    } catch (err) {
      if (err.message !== ultimoError) console.warn("⚠️ Conciliación de pagos:", err.message);
      ultimoError = err.message;
    }
  };

  console.log("🔁 Sin MP_NOTIFICATION_URL: los pagos se concilian con Mercado Pago cada 20 s");
  setTimeout(conciliar, 3000);
  setInterval(conciliar, 20000).unref();
}
