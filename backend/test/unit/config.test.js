// Validación de entorno, guardia de la base de pruebas y utilidades. Sin base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { validarEntorno, config } = require("../../config/env");
const { verificarBaseDePruebas } = require("../../scripts/lib/baseDePruebas");
const { rutaLocal } = require("../../utils/archivos");
const { generarCodigoLlavero } = require("../../utils/codigos");
const { codigoLlaveroValido } = require("../../utils/validacion");

function conEntorno(vars, fn) {
  const previo = {};
  for (const k of Object.keys(vars)) {
    previo[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/reqrdito",
  JWT_SECRET: "x".repeat(40),
  GOOGLE_CLIENT_ID: "id",
  MP_ACCESS_TOKEN: "TEST-1",
  NODE_ENV: "development",
  ADMIN_EMAILS: "a@b.c",
  BREVO_PASS: "x"
};

test("validarEntorno: variables obligatorias y longitud del secreto", () => {
  conEntorno({ ...BASE }, () => assert.deepEqual(validarEntorno().errores, []));
  conEntorno({ ...BASE, JWT_SECRET: undefined }, () => assert.ok(validarEntorno().errores.some(e => /JWT_SECRET/.test(e))));
  conEntorno({ ...BASE, JWT_SECRET: "corto" }, () => assert.ok(validarEntorno().errores.some(e => /32/.test(e))));
  conEntorno({ ...BASE, NODE_ENV: "production", ADMIN_EMAILS: undefined, BREVO_PASS: undefined }, () => {
    const { errores } = validarEntorno();
    assert.ok(errores.some(e => /ADMIN_EMAILS/.test(e)));
    assert.ok(errores.some(e => /BREVO_PASS/.test(e)));
  });
});

test("validarEntorno avisa si se usa una credencial de producción de Mercado Pago en local", () => {
  conEntorno({ ...BASE, MP_ACCESS_TOKEN: "APP_USR-123" }, () => {
    assert.ok(validarEntorno().avisos.some(a => /APP_USR- fuera de producción/.test(a)));
  });
});

test("los avisos y errores nunca incluyen valores de variables", () => {
  conEntorno({ ...BASE, JWT_SECRET: "secreto-corto", MP_ACCESS_TOKEN: "APP_USR-SECRETO-999" }, () => {
    const texto = JSON.stringify(validarEntorno());
    assert.ok(!texto.includes("secreto-corto"));
    assert.ok(!texto.includes("SECRETO-999"));
  });
});

test("config: eventos deshabilitados salvo EVENTS_ENABLED=true; emails simulados fuera de producción", () => {
  conEntorno({ EVENTS_ENABLED: undefined }, () => assert.equal(config.eventsEnabled, false));
  conEntorno({ EVENTS_ENABLED: "1" }, () => assert.equal(config.eventsEnabled, false));
  conEntorno({ EVENTS_ENABLED: "true" }, () => assert.equal(config.eventsEnabled, true));
  conEntorno({ NODE_ENV: "development", EMAIL_ENABLED: undefined }, () => assert.equal(config.emailEnabled, false));
  conEntorno({ NODE_ENV: "production", EMAIL_ENABLED: undefined }, () => assert.equal(config.emailEnabled, true));
  conEntorno({ NODE_ENV: "production", EMAIL_ENABLED: "false" }, () => assert.equal(config.emailEnabled, false));
  conEntorno({ ADMIN_EMAILS: " A@B.com , c@d.com ," }, () => assert.deepEqual(config.adminEmails, ["a@b.com", "c@d.com"]));
});

test("guardia de base de pruebas: rechaza destinos peligrosos o ambiguos", () => {
  const ok = { testUrl: "postgresql://t:p@127.0.0.1:5432/reqrdito_test", principalUrl: BASE.DATABASE_URL, permiso: "yes" };
  assert.equal(verificarBaseDePruebas(ok).db, "reqrdito_test");
  assert.equal(verificarBaseDePruebas({ ...ok, testUrl: "postgresql://t:p@localhost/reqrdito_test_ci" }).db, "reqrdito_test_ci");

  const casos = [
    [{ ...ok, testUrl: undefined }, /TEST_DATABASE_URL/],
    [{ ...ok, permiso: undefined }, /ALLOW_TEST_DB_RESET/],
    [{ ...ok, permiso: "true" }, /ALLOW_TEST_DB_RESET/],
    [{ ...ok, nodeEnv: "production" }, /production/],
    [{ ...ok, testUrl: "postgresql://t:p@127.0.0.1/reqrdito" }, /no se llama/],
    [{ ...ok, testUrl: "postgresql://t:p@127.0.0.1/test" }, /no se llama/],
    [{ ...ok, testUrl: "postgresql://t:p@127.0.0.1/produccion_test" }, /no se llama/],
    [{ ...ok, testUrl: "postgresql://t:p@127.0.0.1/reqrdito_test;drop" }, /no se llama/],
    [{ ...ok, testUrl: "postgresql://t:p@db.reqrdito.com/reqrdito_test" }, /no es local/],
    [{ ...ok, testUrl: "no es url" }, /URL válida/],
    [{ ...ok, principalUrl: "postgresql://u:p@127.0.0.1:5432/reqrdito_test" }, /misma base/]
  ];
  for (const [opciones, error] of casos) {
    assert.throws(() => verificarBaseDePruebas(opciones), error, JSON.stringify(opciones));
  }
});

test("rutaLocal solo resuelve archivos dentro de uploads/audio y uploads/qr", () => {
  assert.ok(rutaLocal("/audio/abc.mp3").endsWith(path.join("uploads", "audio", "abc.mp3")));
  assert.ok(rutaLocal("/qr/abc.png").endsWith(path.join("uploads", "qr", "abc.png")));
  for (const malo of ["/audio/../../.env", "/audio/..", "/audio/.env", "/temp/x.mp3", "https://x/audio/a.mp3", "/audio/a/b.mp3", null, 3]) {
    assert.equal(rutaLocal(malo), null, String(malo));
  }
});

test("códigos de llavero: formato, alfabeto sin ambigüedades y validación", () => {
  const codigos = new Set(Array.from({ length: 2000 }, () => generarCodigoLlavero()));
  assert.equal(codigos.size, 2000, "sin colisiones en 2000 códigos");
  for (const c of codigos) assert.match(c, /^QR-[A-HJ-NP-Z2-9]{8}$/);
  assert.match(generarCodigoLlavero("KEY", 6), /^KEY[A-HJ-NP-Z2-9]{6}$/);

  for (const ok of ["QR-ABCD2345", "KEYAB12CD", "a_b-1"]) assert.ok(codigoLlaveroValido(ok), ok);
  for (const malo of ["", "../x", "a b", "x".repeat(33), ["QR-1"], null]) assert.ok(!codigoLlaveroValido(malo), String(malo));
});
