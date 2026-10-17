// Precios oficiales y sincronización frontend/backend. No usa base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { PRECIOS, PRECIOS_ANTERIORES, MONEDA, precioDe } = require("../../config/precios");

const FRONTEND = path.join(__dirname, "../../../frontend");

test("precios oficiales: Individual $11.990 ARS y Dúo $21.990 ARS", () => {
  assert.equal(MONEDA, "ARS");
  assert.deepEqual(
    { individual: PRECIOS.individual.monto, pareja: PRECIOS.pareja.monto },
    { individual: 11990, pareja: 21990 }
  );
  assert.equal(PRECIOS.pareja.nombre, "Dúo");
  assert.equal(PRECIOS.individual.moneda, "ARS");
  assert.equal(PRECIOS.pareja.moneda, "ARS");
  assert.ok(Object.isFrozen(PRECIOS) && Object.isFrozen(PRECIOS.individual));
});

test("precioDe solo devuelve packs conocidos", () => {
  assert.equal(precioDe("individual").monto, 11990);
  assert.equal(precioDe("pareja").monto, 21990);
  for (const pack of ["duo", "evento", "__proto__", "constructor", undefined, ""]) {
    assert.equal(precioDe(pack), null, String(pack));
  }
});

test("la tarifa anterior solo se conserva para preferencias históricas", () => {
  assert.deepEqual(PRECIOS_ANTERIORES, { individual: 6900, pareja: 10900 });
});

test("pago.html usa /api/precios y su respaldo coincide con el backend", () => {
  const html = fs.readFileSync(path.join(FRONTEND, "pago.html"), "utf8");
  assert.match(html, /api\/precios/);
  const respaldo = html.match(/PRECIOS_RESPALDO\s*=\s*\{([^}]*)\}/);
  assert.ok(respaldo, "falta PRECIOS_RESPALDO");
  assert.match(respaldo[1], /individual:\s*11990\b/);
  assert.match(respaldo[1], /pareja:\s*21990\b/);
  assert.match(html, /Recuerdo Dúo/);
  // el navegador solo envía el id: nunca un importe
  const envio = html.match(/body:\s*JSON\.stringify\(([^)]*)\)/);
  assert.equal(envio[1].trim(), "{ recuerdoId }");
});

test("el formato mostrado es exactamente $11.990 ARS / $21.990 ARS", () => {
  // misma expresión que pago.html
  const formato = (n) => `$${n.toLocaleString("es-AR")} ARS`;
  assert.equal(formato(PRECIOS.individual.monto), "$11.990 ARS");
  assert.equal(formato(PRECIOS.pareja.monto), "$21.990 ARS");
});

test("no quedan precios viejos en pantallas ni scripts activos del frontend", () => {
  const viejos = /\b(6[.,]?900|10[.,]?900)\b/;
  const archivos = [
    ...fs.readdirSync(FRONTEND).filter(f => f.endsWith(".html")),
    ...fs.readdirSync(path.join(FRONTEND, "js")).map(f => `js/${f}`)
  ];
  for (const f of archivos) {
    const contenido = fs.readFileSync(path.join(FRONTEND, f), "utf8");
    assert.ok(!viejos.test(contenido), `precio viejo en ${f}`);
  }
});

test("las pantallas muestran la denominación comercial Dúo (no Duo/Pareja)", () => {
  for (const f of ["index.html", "crear-recuerdo.html", "pago.html", "admin-keychains.html"]) {
    const texto = fs.readFileSync(path.join(FRONTEND, f), "utf8")
      .replace(/<script[\s\S]*?<\/script>/g, "")       // solo texto visible
      .replace(/value="pareja"|data-pack="pareja"/g, ""); // valores internos
    assert.ok(!/\bDuo\b/.test(texto), `"Duo" sin tilde en ${f}`);
    assert.ok(!/>\s*Pareja\s*</.test(texto), `"Pareja" visible en ${f}`);
  }
});

test("el backend no tiene importes hardcodeados fuera de config/precios.js", () => {
  const raiz = path.join(__dirname, "../..");
  for (const f of ["routes/pago.js", "routes/webhook.js", "services/pagos.js"]) {
    const contenido = fs.readFileSync(path.join(raiz, f), "utf8");
    assert.ok(!/\b(6900|10900|11990|21990)\b/.test(contenido), f);
  }
});
