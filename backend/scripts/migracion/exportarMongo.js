// Exportación de SOLO LECTURA de MongoDB (Atlas) para la migración histórica.
//
// Uso:
//   MONGODB_DRIVER=<carpeta con node_modules/mongodb> node scripts/migracion/exportarMongo.js --out <carpeta-nueva>
//   (el driver no es dependencia del backend: instalarlo aparte con
//    `npm install --no-save mongodb@6.9.0` en una carpeta temporal)
//
// - Solo usa listCollections, buildInfo, countDocuments y find: nunca escribe.
// - Lee MONGO_URI del entorno o de backend/.env; nunca la imprime.
// - Escribe <colección>.json (Extended JSON relajado, --jsonArray) y MANIFIESTO.json
//   con recuentos, campos presentes (solo nombres) y SHA-256 de cada archivo.
// - La carpeta de salida debe NO existir (no sobrescribe exportaciones previas).
// - La consola solo muestra nombres de colecciones, recuentos y nombres de campos.
require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const driver = process.env.MONGODB_DRIVER
  ? require(require.resolve("mongodb", { paths: [process.env.MONGODB_DRIVER] }))
  : require("mongodb");
const { MongoClient, ReadPreference } = driver;
// mongodb 6.x exporta EJSON; desde 7.x está en driver.BSON.EJSON
const EJSON = driver.EJSON || (driver.BSON && driver.BSON.EJSON);
if (!EJSON || !ReadPreference) throw new Error("Versión del driver mongodb no soportada (falta EJSON o ReadPreference)");

function sha256(archivo) {
  return crypto.createHash("sha256").update(fs.readFileSync(archivo)).digest("hex");
}

// Nombres de campos (con un nivel de anidación) sin valores
function campos(docs) {
  const set = new Set();
  for (const d of docs) {
    for (const [k, v] of Object.entries(d)) {
      set.add(k);
      if (Array.isArray(v) && v[0] && typeof v[0] === "object" && !(v[0] instanceof Date)) {
        for (const k2 of Object.keys(v[0])) set.add(`${k}[].${k2}`);
      }
    }
  }
  return [...set].sort();
}

async function main() {
  const i = process.argv.indexOf("--out");
  const out = i === -1 ? null : path.resolve(process.argv[i + 1] || "");
  if (!out) throw new Error("Indicá --out <carpeta-nueva>");
  if (fs.existsSync(out)) throw new Error("La carpeta de salida ya existe: no se sobrescriben exportaciones");
  if (!process.env.MONGO_URI) throw new Error("Falta MONGO_URI");

  const client = new MongoClient(process.env.MONGO_URI, {
    readPreference: ReadPreference.SECONDARY_PREFERRED,
    appName: "reqrdito-export-solo-lectura",
    serverSelectionTimeoutMS: 20000
  });

  await client.connect();
  try {
    const db = client.db(); // base indicada en la URI
    const info = await db.command({ buildInfo: 1 });
    const colecciones = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map(c => c.name).filter(n => !n.startsWith("system.")).sort();

    fs.mkdirSync(out, { recursive: true });
    const manifiesto = {
      fecha: new Date().toISOString(),
      baseDeDatos: db.databaseName,
      versionServidor: info.version,
      driver: require(require.resolve("mongodb/package.json", { paths: [process.env.MONGODB_DRIVER || __dirname] })).version,
      modo: "solo lectura (find)",
      colecciones: {}
    };

    console.log(`MongoDB ${info.version} · base "${db.databaseName}" · ${colecciones.length} colecciones`);

    for (const nombre of colecciones) {
      const col = db.collection(nombre);
      const esperado = await col.countDocuments();
      const docs = await col.find({}).toArray();
      const archivo = path.join(out, `${nombre}.json`);
      fs.writeFileSync(archivo, EJSON.stringify(docs, null, 0, { relaxed: true }));

      // relectura: el archivo parsea y tiene la misma cantidad de documentos
      const releidos = EJSON.parse(fs.readFileSync(archivo, "utf8"), { relaxed: true });
      if (!Array.isArray(releidos) || releidos.length !== docs.length) {
        throw new Error(`Relectura inconsistente en ${nombre}`);
      }

      manifiesto.colecciones[nombre] = {
        documentos: docs.length,
        countDocuments: esperado,
        campos: campos(docs),
        bytes: fs.statSync(archivo).size,
        sha256: sha256(archivo)
      };
      const aviso = esperado !== docs.length ? ` (countDocuments=${esperado}: cambió durante la exportación)` : "";
      console.log(`  ${nombre}: ${docs.length} documentos${aviso}`);
    }

    fs.writeFileSync(path.join(out, "MANIFIESTO.json"), JSON.stringify(manifiesto, null, 2));
    fs.writeFileSync(path.join(out, "SHA256SUMS.txt"),
      Object.keys(manifiesto.colecciones).map(n => `${manifiesto.colecciones[n].sha256} *${n}.json`).join("\n") + "\n");
    console.log(`Exportación completa en: ${out}`);
    return manifiesto;
  } finally {
    await client.close();
  }
}

main().catch(err => {
  // el mensaje del driver puede incluir el host, nunca la contraseña; igual se recorta
  console.error("✗", String(err.message).replace(/mongodb(\+srv)?:\/\/[^\s]+/g, "mongodb://***"));
  process.exitCode = 1;
});
