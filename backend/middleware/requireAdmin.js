const { config } = require("../config/env");

// Paneles administrativos: sesión válida y email incluido en ADMIN_EMAILS.
// Debe ir después de auth y requireAuth. Con ADMIN_EMAILS vacío no entra nadie.
module.exports = function requireAdmin(req, res, next) {
  if (!req.user || !config.adminEmails.includes(req.user.email)) {
    return res.status(403).json({ error: "No autorizado" });
  }
  next();
};
