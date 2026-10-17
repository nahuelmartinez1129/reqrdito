// El entorno de pruebas local (npm run dev) nunca puede apuntar a la base principal.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validarDestino } = require("../../scripts/lib/entornoLocal");

const url = (base, host = "localhost") => `postgresql://app:clave-secreta@${host}:5432/${base}`;

test("acepta reqrdito_dev local", () => {
  assert.deepEqual(validarDestino(url("reqrdito_dev"), "development"),
    { host: "localhost", puerto: "5432", base: "reqrdito_dev", usuario: "app" });
  assert.equal(validarDestino(url("reqrdito_dev_2", "127.0.0.1")).base, "reqrdito_dev_2");
});

test("rechaza la base principal y otras bases", () => {
  for (const base of ["reqrdito", "reqrdito_test", "postgres", "reqrdito_devX"]) {
    assert.throws(() => validarDestino(url(base), "development"), /reqrdito_dev/, base);
  }
});

test("rechaza hosts remotos y modo producción", () => {
  assert.throws(() => validarDestino(url("reqrdito_dev", "72.61.33.73")), /local/);
  assert.throws(() => validarDestino(url("reqrdito_dev"), "production"), /production/);
});

test("los errores no incluyen la contraseña", () => {
  try { validarDestino(url("reqrdito")); } catch (e) { assert.ok(!e.message.includes("clave-secreta")); }
  try { validarDestino("no-es-url"); } catch (e) { assert.ok(!e.message.includes("no-es-url")); }
});
