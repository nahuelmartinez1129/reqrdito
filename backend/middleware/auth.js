const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function (req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader) return next();

  const token = authHeader.split(" ")[1];
  if (!token) return next();

  try {

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    console.log("DECODED:", decoded); // 🔍 DEBUG

    // 🔥 BUSCAR POR EMAIL (más confiable)
    const user = await User.findOne({ email: decoded.email });

    if (!user) {
      console.log("❌ Usuario no encontrado");
      return next();
    }

    req.user = user;

    // compatibilidad
    req.user.id = user._id;

    next();

  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
};
