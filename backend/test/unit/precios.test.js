// Precios oficiales y sincronización frontend/backend. No usa base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { PRECIOS, PRECIOS_ANTERIORES, MONEDA, precioDe } = require("../../config/precios");

const FRONTEND = path.join(__dirname, "../../../frontend");

test("precios oficiales: Individual $11.990 ARS y Dúo $14.990 ARS", () => {
  assert.equal(MONEDA, "ARS");
  assert.deepEqual(
    { individual: PRECIOS.individual.monto, pareja: PRECIOS.pareja.monto },
    { individual: 11990, pareja: 14990 }
  );
  assert.equal(PRECIOS.pareja.nombre, "Dúo");
  assert.equal(PRECIOS.individual.moneda, "ARS");
  assert.equal(PRECIOS.pareja.moneda, "ARS");
  assert.ok(Object.isFrozen(PRECIOS) && Object.isFrozen(PRECIOS.individual));
});

test("precioDe solo devuelve packs conocidos", () => {
  assert.equal(precioDe("individual").monto, 11990);
  assert.equal(precioDe("pareja").monto, 14990);
  for (const pack of ["duo", "evento", "__proto__", "constructor", undefined, ""]) {
    assert.equal(precioDe(pack), null, String(pack));
  }
});

test("la tarifa anterior solo se conserva para preferencias históricas", () => {
  assert.deepEqual(PRECIOS_ANTERIORES, { individual: [6900], pareja: [10900, 21990] });
});

test("pago.html usa /api/precios y su respaldo coincide con el backend", () => {
  const html = fs.readFileSync(path.join(FRONTEND, "pago.html"), "utf8");
  assert.match(html, /api\/precios/);
  const respaldo = html.match(/PRECIOS_RESPALDO\s*=\s*\{([^}]*)\}/);
  assert.ok(respaldo, "falta PRECIOS_RESPALDO");
  assert.match(respaldo[1], /individual:\s*11990\b/);
  assert.match(respaldo[1], /pareja:\s*14990\b/);
  assert.match(html, /Recuerdo Dúo/);
  // el navegador solo envía el id (y las cookies del pixel de Meta): nunca un importe
  const envio = html.match(/body:\s*JSON\.stringify\((\{[^}]*\})\)/);
  assert.equal(envio[1].trim(), '{ recuerdoId, fbp: cookie("_fbp"), fbc: cookie("_fbc") }');
});

test("la landing usa /api/precios y su respaldo coincide con el backend", () => {
  const html = fs.readFileSync(path.join(FRONTEND, "index.html"), "utf8");
  assert.match(html, /api\/precios/);
  const formato = (n) => `$${n.toLocaleString("es-AR")}`;
  const mostrados = [...html.matchAll(/data-precio="(\w+)">([^<]*)</g)];
  assert.ok(mostrados.length >= 4, "faltan precios en la landing");
  for (const [, pack, texto] of mostrados) {
    assert.ok(PRECIOS[pack], `pack desconocido: ${pack}`);
    assert.equal(texto, formato(PRECIOS[pack].monto), `precio de ${pack} en index.html`);
  }
});

test("el formato mostrado es exactamente $11.990 ARS / $14.990 ARS", () => {
  // misma expresión que pago.html
  const formato = (n) => `$${n.toLocaleString("es-AR")} ARS`;
  assert.equal(formato(PRECIOS.individual.monto), "$11.990 ARS");
  assert.equal(formato(PRECIOS.pareja.monto), "$14.990 ARS");
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
    assert.ok(!/\b(6900|10900|11990|14990|21990)\b/.test(contenido), f);
  }
});

/* =========================
   Precio temporal de prueba
========================= */
const { precioACobrar, estadoPrecioPrueba } = require("../../config/precios");

const AHORA = new Date("2026-10-18T12:00:00-03:00");
const YO = "Tester@Example.com";
const PROD = {
  NODE_ENV: "production",
  PRECIO_PRUEBA_INDIVIDUAL_ARS: "100",
  PRECIO_PRUEBA_HASTA: "2026-10-19T23:59:00-03:00",
  PRECIO_PRUEBA_EMAILS: " tester@example.com , otra@example.com "
};

test("precio de prueba vigente: solo el Individual de una cuenta habilitada", () => {
  const p = precioACobrar("individual", YO, PROD, AHORA);
  assert.equal(p.monto, 100);
  assert.equal(p.moneda, "ARS");
  assert.equal(p.prueba, true);
  assert.equal(p.hastaIso, "2026-10-19T23:59:00-03:00");
  assert.equal(precioACobrar("individual", "otra@example.com", PROD, AHORA).monto, 100);
  assert.equal(precioACobrar("pareja", YO, PROD, AHORA).monto, 14990);
  assert.equal(precioACobrar("pareja", YO, PROD, AHORA).prueba, undefined);
  assert.equal(PRECIOS.individual.monto, 11990);
  assert.equal(precioDe("individual").monto, 11990, "la validación histórica sigue con el oficial");
});

test("con el precio de prueba activo, el resto de las cuentas paga el oficial", () => {
  for (const email of [undefined, null, "", "cliente@example.com", "tester@example.com.ar", "xtester@example.com"]) {
    assert.equal(precioACobrar("individual", email, PROD, AHORA), PRECIOS.individual, String(email));
  }
});

test("sin variables se cobra el precio oficial", () => {
  assert.equal(precioACobrar("individual", YO, { NODE_ENV: "production" }, AHORA), PRECIOS.individual);
  assert.equal(estadoPrecioPrueba({ NODE_ENV: "production" }, AHORA).motivo, "sin_configurar");
});

test("precio de prueba nunca se aplica fuera de producción", () => {
  for (const NODE_ENV of [undefined, "", "development", "test", "Production"]) {
    const env = { ...PROD, NODE_ENV };
    assert.equal(precioACobrar("individual", YO, env, AHORA).monto, 11990, String(NODE_ENV));
    assert.equal(estadoPrecioPrueba(env, AHORA).motivo, "fuera_de_produccion");
  }
});

test("precio de prueba vencido o con ventana demasiado larga vuelve al oficial", () => {
  const vencido = { ...PROD, PRECIO_PRUEBA_HASTA: "2026-10-18T11:59:59-03:00" };
  assert.equal(precioACobrar("individual", YO, vencido, AHORA).monto, 11990);
  assert.equal(estadoPrecioPrueba(vencido, AHORA).motivo, "vencido");
  // justo al vencer ya no vale
  const justo = { ...PROD, PRECIO_PRUEBA_HASTA: "2026-10-18T12:00:00-03:00" };
  assert.equal(precioACobrar("individual", YO, justo, AHORA).monto, 11990);
  const largo = { ...PROD, PRECIO_PRUEBA_HASTA: "2026-10-21T12:00:01-03:00" };
  assert.equal(estadoPrecioPrueba(largo, AHORA).motivo, "ventana_demasiado_larga");
  assert.equal(precioACobrar("individual", YO, largo, AHORA).monto, 11990);
});

test("configuraciones inválidas del precio de prueba no se aplican", () => {
  const casos = [
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "0" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "-100" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "100.5" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "1e2" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "11990" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_INDIVIDUAL_ARS: "50000" }, "monto_invalido"],
    [{ PRECIO_PRUEBA_HASTA: undefined }, "fecha_invalida"],
    [{ PRECIO_PRUEBA_HASTA: "mañana" }, "fecha_invalida"],
    [{ PRECIO_PRUEBA_HASTA: "2026-10-19T23:59:00" }, "fecha_invalida"],   // sin zona horaria
    [{ PRECIO_PRUEBA_HASTA: "2026-10-19" }, "fecha_invalida"],
    [{ PRECIO_PRUEBA_HASTA: "2026-13-45T25:99:00Z" }, "fecha_invalida"],
    [{ PRECIO_PRUEBA_EMAILS: undefined }, "emails_invalidos"],              // obligatoria
    [{ PRECIO_PRUEBA_EMAILS: " , " }, "emails_invalidos"],
    [{ PRECIO_PRUEBA_EMAILS: "*" }, "emails_invalidos"],
    [{ PRECIO_PRUEBA_EMAILS: "tester@example.com,todos" }, "emails_invalidos"]
  ];
  for (const [cambio, motivo] of casos) {
    const env = { ...PROD, ...cambio };
    assert.equal(estadoPrecioPrueba(env, AHORA).motivo, motivo, JSON.stringify(cambio));
    assert.equal(precioACobrar("individual", YO, env, AHORA).monto, 11990, JSON.stringify(cambio));
  }
});

test("precioACobrar no acepta packs desconocidos", () => {
  for (const pack of ["duo", "evento", "__proto__", "constructor", undefined, ""]) {
    assert.equal(precioACobrar(pack, YO, PROD, AHORA), null, String(pack));
  }
});
