// Aplica las migraciones (prisma migrate deploy: solo agrega, nunca borra) a la base
// de pruebas local reqrdito_dev. Se niega a correr contra otra base.
//   npm run dev:migrate
const { spawnSync } = require("child_process");
const { cargarEntornoLocal, RAIZ } = require("./lib/entornoLocal");

let destino;
try {
  destino = cargarEntornoLocal();
} catch (err) {
  console.error("✗", err.message);
  process.exit(1);
}

console.log(`Migrando base LOCAL ${destino.base} en ${destino.host}:${destino.puerto}`);
for (const accion of ["deploy", "status"]) {
  const r = spawnSync(`npx prisma migrate ${accion}`, { cwd: RAIZ, stdio: "inherit", env: process.env, shell: true });
  if (r.status !== 0) process.exit(r.status || 1);
}
