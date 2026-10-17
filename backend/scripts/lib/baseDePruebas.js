// Validación compartida de la base de PRUEBAS (reset del esquema y TRUNCATE de los tests).
// No confía solo en el nombre: exige autorización explícita, host local,
// nombre exacto y que no coincida con DATABASE_URL.

const NOMBRE_TEST_RE = /^reqrdito_test(_[a-z0-9]+)?$/;
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function destino(url) {
  const u = new URL(url);
  return {
    host: u.hostname.toLowerCase(),
    port: u.port || "5432",
    db: decodeURIComponent(u.pathname.slice(1)),
    user: decodeURIComponent(u.username)
  };
}

// Lanza Error con el motivo si la base no es segura para operaciones destructivas
function verificarBaseDePruebas({ testUrl, principalUrl, permiso, nodeEnv }) {
  if (!testUrl) throw new Error("definí TEST_DATABASE_URL (base de pruebas).");
  if (permiso !== "yes") throw new Error("falta ALLOW_TEST_DB_RESET=yes (autorización explícita para borrar la base de pruebas).");
  if (nodeEnv === "production") throw new Error("NODE_ENV=production.");

  let test;
  try {
    test = destino(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL no es una URL válida.");
  }

  if (!HOSTS_LOCALES.has(test.host)) throw new Error(`el host "${test.host}" no es local.`);
  if (!NOMBRE_TEST_RE.test(test.db)) throw new Error(`la base "${test.db}" no se llama reqrdito_test[_sufijo].`);

  if (principalUrl) {
    let principal;
    try {
      principal = destino(principalUrl);
    } catch {
      principal = null;
    }
    if (principal) {
      const mismoHost = principal.host === test.host || (HOSTS_LOCALES.has(principal.host) && HOSTS_LOCALES.has(test.host));
      if (mismoHost && principal.port === test.port && principal.db === test.db) {
        throw new Error("TEST_DATABASE_URL apunta a la misma base que DATABASE_URL.");
      }
    }
  }

  return test;
}

module.exports = { verificarBaseDePruebas, destino, NOMBRE_TEST_RE };
