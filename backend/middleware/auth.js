const jwt = require("jsonwebtoken");
const prisma = require("../db/prisma");
const { normalizarEmail, isUuid } = require("../utils/validacion");

// Autenticación: si llega "Authorization: Bearer <jwt>" válido, carga req.user.
// Sin header sigue de largo (las rutas que exigen sesión usan requireAuth).
// Un header mal formado, un token inválido o de un usuario que ya no existe
// responde 401: nunca se continúa como anónimo con un token roto.
module.exports = async function (req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader) return next();

  const [esquema, token, ...resto] = authHeader.trim().split(/\s+/);

  if (!/^Bearer$/i.test(esquema) || !token || resto.length) {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }

  let decoded;

  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }

  try {

    // Tokens actuales llevan el id de PostgreSQL; los de versiones previas solo el email
    const user = isUuid(decoded.id)
      ? await prisma.user.findUnique({ where: { id: decoded.id } })
      : await prisma.user.findUnique({ where: { email: normalizarEmail(decoded.email) } });

    if (!user || (decoded.email && normalizarEmail(decoded.email) !== user.email)) {
      return res.status(401).json({ error: "Sesión inválida" });
    }

    req.user = user;

    next();

  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(500).json({ error: "Error del servidor" });
  }
};
