const { sendEmail } = require("../services/emailService");

/**
 * Envía el email de recuerdo creado
 * @param {string} email - email del usuario
 * @param {string} codigoRecuerdo - recuerdoId (ej: REQRDITO-9A7KQ2)
 */
module.exports = async function enviarEmail(email, codigoRecuerdo) {
  try {
    const linkRecuerdo = `https://reqrdito.com/recuerdo.html?id=${codigoRecuerdo}`;


    console.log("📧 Enviando email a:", email);
    console.log("🔗 Link del recuerdo:", linkRecuerdo);

    await sendEmail(
      email,
      "🎁 Tu recuerdo ReQRdito está listo",
      "recuerdo-creado.html",
      {
        CODIGO: codigoRecuerdo,
        LINK_RECUERDO: linkRecuerdo,
      }
    );

    console.log("✅ Email enviado correctamente");

  } catch (error) {
    console.error("❌ Error enviando email:", error);
    throw error; // importante para que el webhook lo registre
  }
};
