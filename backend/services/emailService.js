const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// 🔐 SMTP BREVO
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: "a0279f001@smtp-brevo.com", // IDENTIFICADOR SMTP
    pass: process.env.BREVO_PASS,    // PASSWORD SMTP
  },
});

// 📄 Render de template HTML
function renderTemplate(templateName, variables = {}) {
  let html = fs.readFileSync(
    path.join(__dirname, "../emails", templateName),
    "utf8"
  );

  for (const key in variables) {
    html = html.replace(new RegExp(`{{${key}}}`, "g"), variables[key]);
  }

  return html;
}

// 📩 Envío de email
async function sendEmail(to, subject, template, variables = {}) {
  const html = renderTemplate(template, variables);

  console.log("✉️ Enviando mail Brevo a:", to);

  await transporter.sendMail({
    from: '"ReQRdito" <contacto@reqrdito.com>',
    to,
    subject,
    html,
  });
}

module.exports = { sendEmail };
