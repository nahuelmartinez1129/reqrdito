const emailService = require("../services/emailService.js");
const { config } = require("../config/env");

/**
 * Envía el email de recuerdo creado / pago confirmado
 * @param {string} email - email del usuario
 * @param {string} codigoRecuerdo - recuerdoId (UUID)
 * @returns {Promise<{enviado: boolean, simulado?: boolean}>}
 */
module.exports = async function enviarEmail(email, codigoRecuerdo) {
  const linkRecuerdo = `${config.frontendUrl}/recuerdo.html?id=${encodeURIComponent(codigoRecuerdo)}`;

  // Los errores se propagan: el webhook deja el email pendiente para reintentarlo
  return emailService.sendEmail(
    email,
    "🎁 Tu recuerdo ReQRdito está listo",
    "recuerdo-creado.html",
    {
      CODIGO: codigoRecuerdo,
      LINK_RECUERDO: linkRecuerdo,
    }
  );
};
