const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { config } = require("../config/env");

const TEMPLATES_DIR = path.join(__dirname, "../emails");

// 🔐 SMTP BREVO (la contraseña solo se lee del entorno)
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER || "a0279f001@smtp-brevo.com", // IDENTIFICADOR SMTP
    pass: process.env.BREVO_PASS,                               // PASSWORD SMTP
  },
});

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 📄 Render de template HTML: solo nombres de archivo de emails/ y variables escapadas
function renderTemplate(templateName, variables = {}) {
  const archivo = path.basename(String(templateName));

  if (archivo !== templateName || !archivo.endsWith(".html")) {
    throw new Error(`Template inválido: ${templateName}`);
  }

  let html = fs.readFileSync(path.join(TEMPLATES_DIR, archivo), "utf8");

  for (const [key, valor] of Object.entries(variables)) {
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    html = html.split(`{{${key}}}`).join(escaparHtml(valor));
  }

  return html;
}

// reqrdito.com no tiene casilla: se envía desde contacto@ (dominio autenticado en Brevo)
// y las respuestas de los clientes van a EMAIL_REPLY_TO
const REMITENTE = '"ReQRdito" <contacto@reqrdito.com>';

function opcionesMail(to, subject, html) {
  return { from: REMITENTE, replyTo: config.emailReplyTo, to, subject, html };
}

// 📩 Envío de email. Devuelve { enviado: true } o { enviado: false, simulado: true }
// cuando los emails están deshabilitados (fuera de producción sin EMAIL_ENABLED=true).
// Los errores SMTP se propagan para que quien llama decida si reintentar.
async function sendEmail(to, subject, template, variables = {}) {
  const html = renderTemplate(template, variables);

  if (!config.emailEnabled) {
    console.log(`✉️ [simulado] email "${template}" no enviado (EMAIL_ENABLED desactivado)`);
    return { enviado: false, simulado: true };
  }

  await transporter.sendMail(opcionesMail(to, subject, html));

  return { enviado: true };
}

module.exports = { sendEmail, renderTemplate, escaparHtml, opcionesMail };
