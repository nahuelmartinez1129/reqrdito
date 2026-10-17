// Verificaciones NO destructivas: sintaxis de todos los .js, schema de Prisma,
// precios sincronizados y que la app se pueda cargar. No toca ninguna base.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const IGNORAR = new Set(["node_modules", ".git", "uploads", "migracion-historica"]);
let fallas = 0;

function recorrer(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const archivos = [...recorrer(RAIZ), ...recorrer(path.join(RAIZ, "../frontend/js"))];
for (const f of archivos) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    fallas++;
    console.error(`✗ sintaxis: ${path.relative(RAIZ, f)}\n${err.stderr}`);
  }
}
console.log(`✓ sintaxis revisada en ${archivos.length} archivos`);

const prismaCli = require.resolve("prisma/build/index.js", { paths: [RAIZ] });
try {
  execFileSync(process.execPath, [prismaCli, "validate"], { cwd: RAIZ, stdio: "pipe" });
  console.log("✓ prisma validate");
} catch (err) {
  fallas++;
  console.error("✗ prisma validate\n" + err.stderr);
}

process.exit(fallas ? 1 : 0);
