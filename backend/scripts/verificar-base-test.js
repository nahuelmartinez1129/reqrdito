// Verifica (sin borrar nada) que TEST_DATABASE_URL es una base de pruebas segura.
// Muestra solo host, puerto, base y usuario; nunca la contraseña ni la URL.
// Uso: node scripts/verificar-base-test.js
require("dotenv").config({ quiet: true });

const { Client } = require("pg");
const { verificarBaseDePruebas } = require("./lib/baseDePruebas");

(async () => {
  // permiso "yes" solo para evaluar las reglas: este script no ejecuta nada destructivo
  const test = verificarBaseDePruebas({
    testUrl: process.env.TEST_DATABASE_URL,
    principalUrl: process.env.DATABASE_URL,
    permiso: "yes",
    nodeEnv: process.env.NODE_ENV
  });
  console.log(`Destino de pruebas: host=${test.host} puerto=${test.port} base=${test.db} usuario=${test.user}`);
  console.log("✓ distinto de DATABASE_URL, host local, nombre de pruebas");

  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows: [r] } = await client.query(
      "select current_database() db, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user"
    );
    if (r.db !== test.db) throw new Error(`conectado a ${r.db}, no a ${test.db}`);
    if (r.rolsuper || r.rolcreatedb || r.rolcreaterole) throw new Error("el rol de pruebas tiene privilegios elevados");
    console.log("✓ conexión real a la base esperada con un rol sin privilegios elevados");
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
