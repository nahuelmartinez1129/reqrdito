// Corta la petición si el middleware auth no pudo identificar al usuario
module.exports = function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Sesión requerida" });
  }
  next();
};
