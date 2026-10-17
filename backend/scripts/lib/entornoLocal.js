// Entorno de pruebas local (npm run dev, npm run dev:migrate).
//
// Carga backend/.env y encima backend/.env.local (que pisa lo que defina), y verifica
// que nunca se use la base principal ni el modo producción:
//   - .env.local debe existir y definir DATABASE_URL
//   - la base debe ser local y llamarse reqrdito_dev (o reqrdito_dev_<algo>)
//   - NODE_ENV no puede ser "production"
// Nunca imprime valores: solo host, puerto, base y usuario.
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const RAIZ = path.join(__dirname, "../..");
// REQRDITO_ENV_LOCAL permite indicar otro archivo (p. ej. para una prueba de humo aislada)
const ENV_LOCAL = process.env.REQRDITO_ENV_LOCAL
  ? path.resolve(process.env.REQRDITO_ENV_LOCAL)
  : path.join(RAIZ, ".env.local");
const NOMBRE_DEV = /^reqrdito_dev(_[a-z0-9]+)?$/;
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1"]);

function cargarEntornoLocal() {
  if (!fs.existsSync(ENV_LOCAL)) {
    throw new Error("Falta backend/.env.local (copiá .env.local.example y completalo)");
  }

  dotenv.config({ path: path.join(RAIZ, ".env"), quiet: true });
  const local = dotenv.parse(fs.readFileSync(ENV_LOCAL));
  if (!local.DATABASE_URL) throw new Error(".env.local debe definir DATABASE_URL (base reqrdito_dev)");
  Object.assign(process.env, local);

  // carpeta de archivos relativa a backend/ (no al directorio desde donde se corre)
  if (process.env.UPLOADS_DIR) process.env.UPLOADS_DIR = path.resolve(RAIZ, process.env.UPLOADS_DIR);

  return validarDestino(process.env.DATABASE_URL, process.env.NODE_ENV);
}

// Devuelve { host, puerto, base, usuario } o lanza si el destino no es la base local de pruebas
function validarDestino(databaseUrl, nodeEnv) {
  if (nodeEnv === "production") {
    throw new Error("NODE_ENV=production no está permitido en el entorno local");
  }

  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL de .env.local no es una URL válida");
  }
  const base = decodeURIComponent(url.pathname.slice(1));
  if (!HOSTS_LOCALES.has(url.hostname)) throw new Error(`La base de pruebas debe ser local (host: ${url.hostname})`);
  if (!NOMBRE_DEV.test(base)) throw new Error(`La base de pruebas debe llamarse reqrdito_dev (actual: ${base})`);

  return { host: url.hostname, puerto: url.port || "5432", base, usuario: decodeURIComponent(url.username) };
}

module.exports = { cargarEntornoLocal, validarDestino, RAIZ };
