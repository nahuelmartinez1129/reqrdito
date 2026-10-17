// Qué credenciales de Mercado Pago pueden crear preferencias según el entorno.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { credencialPermitida, verificador } = require("../../services/mpCredencial");

async function con(entorno, esPrueba, fn) {
  const previo = { ...process.env };
  const original = verificador.esCuentaDePrueba;
  let consultas = 0;
  verificador.esCuentaDePrueba = async () => { consultas++; if (esPrueba instanceof Error) throw esPrueba; return esPrueba; };
  delete process.env.MP_ALLOW_PRODUCTION_TOKEN;
  Object.assign(process.env, entorno);
  try {
    return await fn(() => consultas);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in previo)) delete process.env[k];
    Object.assign(process.env, previo);
    verificador.esCuentaDePrueba = original;
  }
}

test("TEST- se permite fuera de producción sin consultar a Mercado Pago", () =>
  con({ NODE_ENV: "development", MP_ACCESS_TOKEN: "TEST-1" }, false, async consultas => {
    assert.equal(await credencialPermitida(), true);
    assert.equal(consultas(), 0);
  }));

test("APP_USR- de una cuenta de prueba se permite fuera de producción", () =>
  con({ NODE_ENV: "development", MP_ACCESS_TOKEN: "APP_USR-prueba-a" }, true, async () => {
    assert.equal(await credencialPermitida(), true);
  }));

test("APP_USR- de la cuenta real se bloquea fuera de producción", () =>
  con({ NODE_ENV: "development", MP_ACCESS_TOKEN: "APP_USR-real-b" }, false, async () => {
    assert.equal(await credencialPermitida(), false);
  }));

test("si no se puede verificar la cuenta (sin red) se bloquea", () =>
  con({ NODE_ENV: "development", MP_ACCESS_TOKEN: "APP_USR-sin-red-c" }, new Error("ECONNREFUSED"), async () => {
    assert.equal(await credencialPermitida(), false);
  }));

test("credencial vacía o desconocida se bloquea fuera de producción", () =>
  con({ NODE_ENV: "development", MP_ACCESS_TOKEN: "" }, true, async () => {
    assert.equal(await credencialPermitida(), false);
  }));

test("en producción no se consulta nada", () =>
  con({ NODE_ENV: "production", MP_ACCESS_TOKEN: "APP_USR-real-d" }, false, async consultas => {
    assert.equal(await credencialPermitida(), true);
    assert.equal(consultas(), 0);
  }));
