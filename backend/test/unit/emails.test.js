// Plantillas y renderizado seguro de emails. No envía nada ni usa base de datos.
const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.EMAIL_ENABLED = "false";
process.env.NODE_ENV = "test";

const { renderTemplate, escaparHtml, sendEmail } = require("../../services/emailService");

test("las plantillas referenciadas existen y sustituyen sus variables", () => {
  const html = renderTemplate("recuerdo-creado.html", {
    CODIGO: "7d9f0c1e-1111-4222-8333-444455556666",
    LINK_RECUERDO: "https://www.reqrdito.com/recuerdo.html?id=7d9f0c1e-1111-4222-8333-444455556666"
  });
  assert.match(html, /7d9f0c1e-1111-4222-8333-444455556666/);
  assert.match(html, /href="https:\/\/www\.reqrdito\.com\/recuerdo\.html\?id=/);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), "no quedan variables sin sustituir");

  assert.match(renderTemplate("bienvenida.html"), /ReQRdito/);
});

test("las variables se escapan (sin inyección de HTML)", () => {
  const html = renderTemplate("recuerdo-creado.html", {
    CODIGO: `<script>alert(1)</script>`,
    LINK_RECUERDO: `" onmouseover="x`
  });
  assert.ok(!html.includes("<script>alert"));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes(`" onmouseover="x`));
  assert.equal(escaparHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("los valores con $ no rompen la sustitución", () => {
  const html = renderTemplate("recuerdo-creado.html", { CODIGO: "$& $1 $$", LINK_RECUERDO: "x" });
  assert.match(html, /\$&amp; \$1 \$\$/);
});

test("solo se aceptan nombres de plantilla de emails/", () => {
  for (const nombre of ["../.env", "..\\.env", "recuerdo-creado.txt", "/etc/passwd"]) {
    assert.throws(() => renderTemplate(nombre), /Template inválido/, nombre);
  }
  assert.throws(() => renderTemplate("no-existe.html"), /ENOENT/);
});

test("fuera de producción los emails se simulan sin conectarse al SMTP", async () => {
  const r = await sendEmail("alguien@example.com", "Asunto", "recuerdo-creado.html", { CODIGO: "x", LINK_RECUERDO: "y" });
  assert.deepEqual(r, { enviado: false, simulado: true });
});
