const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const prisma = require("../db/prisma");
const { config } = require("../config/env");
const { normalizarEmail } = require("../utils/validacion");

// Único flujo de login activo (routes/auth.js es legacy y no está montado).
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Busca o crea el usuario. El usuario puede existir sin googleId si lo dio de
// alta el panel de eventos o la migración histórica.
async function usuarioDesdeGoogle({ email, name, picture, sub }) {
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    try {
      return await prisma.user.create({
        data: { email, name, picture, googleId: sub }
      });
    } catch (err) {
      // Dos logins simultáneos del mismo usuario: el otro lo creó primero
      if (err.code !== "P2002") throw err;
      user = await prisma.user.findUnique({ where: { email } });
    }
  }

  if (user.googleId && user.googleId !== sub) {
    return null;
  }

  if (!user.googleId) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId: sub,
        name: user.name ?? name,
        picture: user.picture ?? picture
      }
    });
  }

  return user;
}

router.post("/auth/google", async (req, res) => {
  const { credential } = req.body || {};

  if (!credential || typeof credential !== "string") {
    return res.status(400).json({ error: "Token no enviado" });
  }

  let payload;

  try {
    // 🔐 Verificar firma, vencimiento y audiencia del token de Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: "Token de Google inválido" });
  }

  const email = normalizarEmail(payload?.email);
  const sub = typeof payload?.sub === "string" ? payload.sub : "";

  if (!email || !sub) {
    return res.status(400).json({ error: "La cuenta de Google no tiene email" });
  }

  if (payload.email_verified !== true && payload.email_verified !== "true") {
    return res.status(403).json({ error: "El email de la cuenta de Google no está verificado" });
  }

  try {
    const user = await usuarioDesdeGoogle({ email, name: payload.name, picture: payload.picture, sub });

    if (!user) {
      console.warn("Login rechazado: el email ya está vinculado a otra cuenta de Google");
      return res.status(409).json({ error: "Este email ya está vinculado a otra cuenta de Google" });
    }

    // 🔑 Token propio
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: config.jwtExpiresIn, algorithm: "HS256" }
    );

    res.json({
      token,
      email: user.email,
    });

  } catch (err) {
    console.error("Google auth error:", err.message);
    res.status(500).json({ error: "Error autenticando con Google" });
  }
});

module.exports = router;
