// Autenticación, autorización administrativa, CORS, archivos y rutas legacy.
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const h = require("./helpers");
const { api, prisma } = h;

const archivosCreados = [];
const subirRecuerdo = h.crearSubidor(archivosCreados);

before(async () => { await h.iniciar(); });
after(async () => {
  h.borrarArchivosSubidos(archivosCreados);
  await h.detener();
});
beforeEach(async () => { await h.limpiarBase(); });

describe("Login con Google", () => {

  test("email no verificado → 403 y no crea usuario", async () => {
    const res = await api("/api/auth/google", {
      method: "POST",
      json: { credential: JSON.stringify({ email: "ana@example.com", sub: "1", email_verified: false }) }
    });
    assert.equal(res.status, 403);
    assert.equal(await prisma.user.count(), 0);
  });

  test("sin sub o sin email → 400", async () => {
    for (const payload of [{ email: "ana@example.com", email_verified: true }, { sub: "1", email_verified: true }]) {
      const res = await api("/api/auth/google", { method: "POST", json: { credential: JSON.stringify(payload) } });
      assert.equal(res.status, 400);
    }
  });

  test("un email ya vinculado a otra cuenta de Google → 409", async () => {
    await h.login("ana@example.com");
    const res = await api("/api/auth/google", {
      method: "POST",
      json: { credential: JSON.stringify({ email: "ana@example.com", sub: "otro-sub", email_verified: true }) }
    });
    assert.equal(res.status, 409);
  });

  test("logins simultáneos del mismo usuario nuevo no fallan ni duplican", async () => {
    const tokens = await Promise.all(Array.from({ length: 4 }, () => h.login("nuevo@example.com")));
    assert.ok(tokens.every(Boolean));
    assert.equal(await prisma.user.count(), 1);
  });

  test("el token propio lleva id, email, name y vence", async () => {
    const jwt = require("jsonwebtoken");
    const token = await h.login("ana@example.com");
    const p = jwt.decode(token);
    const user = await prisma.user.findFirst();
    assert.equal(p.id, user.id);
    assert.equal(p.email, "ana@example.com");
    assert.ok(p.exp > p.iat);
    assert.ok(p.exp - p.iat <= 60 * 60, "vencimiento corto (30 min por defecto)");
  });

  test("el login no envía email de bienvenida", async () => {
    await h.login("ana@example.com");
    await h.login("ana@example.com");
    assert.equal(h.emails.length, 0);
  });
});

describe("Middleware de autenticación", () => {

  test("exige esquema Bearer y un JWT HS256 firmado con el secreto", async () => {
    const jwt = require("jsonwebtoken");
    const token = await h.login("ana@example.com");

    for (const header of [`Basic ${token}`, `Bearer`, `Bearer ${token} extra`, token]) {
      const res = await api("/api/mis-recuerdos", { headers: { Authorization: header } });
      assert.equal(res.status, 401, header.slice(0, 12));
    }
    assert.equal((await api("/api/mis-recuerdos", { headers: { Authorization: `bearer ${token}` } })).status, 200);

    const ajeno = jwt.sign({ email: "ana@example.com" }, "otro-secreto");
    assert.equal((await api("/api/mis-recuerdos", { token: ajeno })).status, 401);
    const sinFirma = jwt.sign({ email: "ana@example.com" }, null, { algorithm: "none" });
    assert.equal((await api("/api/mis-recuerdos", { token: sinFirma })).status, 401);
    const vencido = jwt.sign({ email: "ana@example.com", exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    assert.equal((await api("/api/mis-recuerdos", { token: vencido })).status, 401);
  });

  test("un token válido de un usuario borrado o recreado no sirve", async () => {
    const token = await h.login("ana@example.com");
    const user = await prisma.user.findFirst();
    await prisma.user.delete({ where: { id: user.id } });
    assert.equal((await api("/api/mis-recuerdos", { token })).status, 401);

    // mismo email, otro usuario: el token viejo (id distinto) no da acceso
    await h.login("ana@example.com");
    assert.equal((await api("/api/mis-recuerdos", { token })).status, 401);
  });

  test("tokens de la versión anterior (solo email) siguen siendo aceptados si el usuario existe", async () => {
    await h.login("ana@example.com");
    assert.equal((await api("/api/mis-recuerdos", { token: h.tokenPara("ana@example.com") })).status, 200);
  });
});

describe("Administración de llaveros", () => {

  const rutas = [
    ["POST", "/api/keychain-admin/generar-individuales", { cantidad: 1 }],
    ["POST", "/api/keychain-admin/generar-pareja", { cantidad: 1 }],
    ["POST", "/api/keychain-admin/limpiar"],
    ["GET", "/api/keychain-admin/generar-pdf"],
    ["GET", "/api/keychain-admin/tanda"]
  ];

  test("sin sesión 401, usuario común 403, admin 200; nadie crea llaveros sin permiso", async () => {
    const comun = await h.login("ana@example.com");
    for (const [method, ruta, json] of rutas) {
      assert.equal((await api(ruta, { method, json })).status, 401, `${ruta} sin sesión`);
      assert.equal((await api(ruta, { method, json, token: comun })).status, 403, `${ruta} usuario común`);
    }
    assert.equal(await prisma.keychain.count(), 0);

    const admin = await h.loginAdmin();
    const res = await api("/api/keychain-admin/generar-individuales", { method: "POST", token: admin, json: { cantidad: 1 } });
    assert.equal(res.status, 200);
  });

  test("ADMIN_EMAILS se compara normalizado (el login guarda el email en minúsculas)", async () => {
    const admin = await h.login("Admin@Example.com");
    assert.equal((await api("/api/keychain-admin/tanda", { token: admin })).status, 200);
  });

  test("con ADMIN_EMAILS vacío nadie entra", async () => {
    const admin = await h.loginAdmin();
    const previo = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "";
    try {
      assert.equal((await api("/api/keychain-admin/tanda", { token: admin })).status, 403);
    } finally {
      process.env.ADMIN_EMAILS = previo;
    }
  });

  test("la tanda no puede superar 500 llaveros", async () => {
    const admin = await h.loginAdmin();
    assert.equal((await api("/api/keychain-admin/generar-individuales", { method: "POST", token: admin, json: { cantidad: 500 } })).status, 200);
    const res = await api("/api/keychain-admin/generar-pareja", { method: "POST", token: admin, json: { cantidad: 1 } });
    assert.equal(res.status, 400);
    assert.equal(await prisma.keychain.count(), 500);
  });
});

describe("Subida de archivos", () => {

  test("rechaza archivos que no son audio (MIME/extensión) sin dejar temporales", async () => {
    const token = await h.login("ana@example.com");
    const form = new FormData();
    form.append("nombre", "x");
    form.append("pack", "individual");
    form.append("audio1", new Blob([Buffer.from("<script>")], { type: "text/html" }), "virus.html");
    const res = await api("/api/upload", { method: "POST", token, form });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Archivo no válido" });
    assert.equal(h.contarArchivos("temp"), 0);
  });

  test("un archivo con MIME de audio pero contenido inválido → 422, sin MP3 parcial ni QR", async () => {
    const token = await h.login("ana@example.com");
    const audios = h.contarArchivos("audio");
    const qrs = h.contarArchivos("qr");
    const { res } = await subirRecuerdo(token, {
      audio: new Blob([Buffer.from("NO-AUDIO: texto")], { type: "audio/webm" })
    });
    assert.equal(res.status, 422);
    assert.equal(h.contarArchivos("audio"), audios);
    assert.equal(h.contarArchivos("qr"), qrs);
    assert.equal(h.contarArchivos("temp"), 0);
    assert.equal(await prisma.recuerdo.count(), 0);
  });

  test("en un Dúo con el segundo audio inválido se limpian también los archivos del primero", async () => {
    const token = await h.login("ana@example.com");
    const audios = h.contarArchivos("audio");
    const form = new FormData();
    form.append("nombre", "Dúo");
    form.append("pack", "pareja");
    form.append("audio1", h.audioFalso(), "a.webm");
    form.append("audio2", new Blob([Buffer.from("NO-AUDIO")], { type: "audio/webm" }), "b.webm");
    const res = await api("/api/upload", { method: "POST", token, form });
    assert.equal(res.status, 422);
    assert.equal(h.contarArchivos("audio"), audios);
    assert.equal(h.contarArchivos("temp"), 0);
  });

  test("archivo de más de 10 MB → 413", async () => {
    const token = await h.login("ana@example.com");
    const form = new FormData();
    form.append("nombre", "x");
    form.append("audio1", new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: "audio/webm" }), "grande.webm");
    const res = await api("/api/upload", { method: "POST", token, form });
    assert.equal(res.status, 413);
    assert.equal(h.contarArchivos("temp"), 0);
  });

  test("el nombre original del archivo nunca se usa como ruta", async () => {
    const token = await h.login("ana@example.com");
    const form = new FormData();
    form.append("nombre", "x");
    form.append("audio1", h.audioFalso(), "../../../app.js");
    const res = await api("/api/upload", { method: "POST", token, form });
    // extensión desconocida pero MIME de audio: se procesa con nombre propio
    assert.equal(res.status, 200);
    const data = await res.json();
    const r = await prisma.recuerdo.findUnique({ where: { id: data.id }, include: { audios: true } });
    archivosCreados.push(r.qrUrl, ...r.audios.map(a => a.url));
    assert.match(r.audios[0].url, /^\/audio\/[0-9a-f-]{36}\.mp3$/);
    assert.ok(fs.existsSync(path.join(h.ROOT, "app.js")));
  });

  test("uploads/temp y uploads/eliminados no se sirven; /audio no permite salir de la carpeta", async () => {
    for (const ruta of ["/temp/x", "/uploads/temp/x", "/eliminados/x", "/audio/..%2F..%2F.env", "/audio/../server.js", "/qr/..%2Fapp.js"]) {
      const res = await api(ruta);
      assert.notEqual(res.status, 200, ruta);
    }
  });
});

describe("Configuración HTTP", () => {

  test("CORS: solo orígenes de ReQRdito (y localhost fuera de producción)", async () => {
    const permitido = await api("/api/precios", { headers: { Origin: "https://www.reqrdito.com" } });
    assert.equal(permitido.headers.get("access-control-allow-origin"), "https://www.reqrdito.com");
    const raiz = await api("/api/precios", { headers: { Origin: "https://reqrdito.com" } });
    assert.equal(raiz.headers.get("access-control-allow-origin"), "https://reqrdito.com");
    const local = await api("/api/precios", { headers: { Origin: "http://localhost:5500" } });
    assert.equal(local.headers.get("access-control-allow-origin"), "http://localhost:5500");

    for (const origen of ["https://evil.example", "https://reqrdito.com.evil.example", "null"]) {
      const res = await api("/api/precios", { headers: { Origin: origen } });
      assert.equal(res.headers.get("access-control-allow-origin"), null, origen);
    }
  });

  test("CORS en producción no acepta localhost", async () => {
    const previo = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await api("/api/precios", { headers: { Origin: "http://localhost:5500" } });
      assert.equal(res.headers.get("access-control-allow-origin"), null);
    } finally {
      process.env.NODE_ENV = previo;
    }
  });

  test("errores sin stack trace ni detalles internos; sin X-Powered-By", async () => {
    const res = await api("/api/auth/google", { method: "POST", json: "{malformado" });
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.ok(!/at |node_modules|SyntaxError/.test(body), body);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");

    const noExiste = await api("/api/no-existe");
    assert.equal(noExiste.status, 404);
    assert.deepEqual(await noExiste.json(), { error: "No encontrado" });
  });

  test("la ruta legacy POST /api/recuerdo ya no crea recuerdos pagados", async () => {
    const token = await h.login("ana@example.com");
    const res = await api("/api/recuerdo", {
      method: "POST", token,
      json: { recuerdoId: "7d9f0c1e-1111-4222-8333-444455556666", audioUrl: "/audio/x.mp3", nombre: "Gratis" }
    });
    assert.equal(res.status, 410);
    assert.equal(await prisma.recuerdo.count(), 0);
  });

  test("los endpoints públicos no exponen datos personales", async () => {
    const token = await h.login("ana@example.com");
    const { data } = await subirRecuerdo(token);
    await prisma.recuerdo.update({ where: { id: data.id }, data: { pagado: true, payerEmail: "pagador@example.com", paymentId: "1" } });
    const texto = await (await api(`/api/recuerdo/${data.id}`)).text();
    assert.ok(!texto.includes("@"), "sin emails");
    assert.ok(!texto.includes("userId"));
  });
});
