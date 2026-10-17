// Recrea desde cero la base de PRUEBAS y aplica las migraciones.
//
// DESTRUCTIVO: ejecuta DROP SCHEMA public CASCADE sobre TEST_DATABASE_URL.
// Controles (todos obligatorios):
//   1. ALLOW_TEST_DB_RESET=yes explícito en el entorno.
//   2. Host local (localhost / 127.0.0.1 / ::1).
//   3. Base con nombre exacto de pruebas (reqrdito_test o reqrdito_test_<algo>).
//   4. Distinta de DATABASE_URL (host + puerto + base) y de cualquier base
//      conocida de producción.
//   5. Conectado, confirma current_database(), que el rol NO sea superusuario y
//      que la base no tenga tablas ajenas al esquema de ReQRdito.
// Muestra el destino antes de actuar.
require("dotenv").config({ quiet: true });

const { execFileSync } = require("child_process");
const path = require("path");
const { Client } = require("pg");

const { verificarBaseDePruebas } = require("./lib/baseDePruebas");

const TABLAS_PERMITIDAS = new Set([
  "_prisma_migrations", "users", "recuerdos", "recuerdo_audios", "keychains",
  "events", "event_qrs", "pagos_revision"
]);

function abortar(msg) {
  console.error(`⛔ Reset de base de pruebas ABORTADO: ${msg}`);
  process.exit(1);
}

const url = process.env.TEST_DATABASE_URL;
let test;

try {
  test = verificarBaseDePruebas({
    testUrl: url,
    principalUrl: process.env.DATABASE_URL,
    permiso: process.env.ALLOW_TEST_DB_RESET,
    nodeEnv: process.env.NODE_ENV
  });
} catch (err) {
  abortar(err.message);
}

console.log("⚠️  Se va a BORRAR y recrear el esquema public de:");
console.log(`    host=${test.host} puerto=${test.port} base=${test.db} usuario=${test.user}`);

(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: [info] } = await client.query(
      "select current_database() as db, r.rolsuper from pg_roles r where r.rolname = current_user"
    );

    if (info.db !== test.db) abortar(`la conexión quedó en "${info.db}", no en "${test.db}".`);
    if (info.rolsuper) abortar("el rol de pruebas es superusuario; usá un rol propio sin privilegios.");

    const { rows: tablas } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'"
    );
    const ajenas = tablas.map(t => t.table_name).filter(t => !TABLAS_PERMITIDAS.has(t));
    if (ajenas.length) abortar(`la base tiene tablas ajenas a ReQRdito (${ajenas.join(", ")}).`);

    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  // Sin shell: en Windows se invoca node con el CLI de Prisma directamente
  const prismaCli = require.resolve("prisma/build/index.js", { paths: [path.join(__dirname, "..")] });
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url }
  });

  console.log(`✅ Base de pruebas ${test.db} recreada y migrada.`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
