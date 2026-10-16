const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User"); // ajustá si tu modelo se llama distinto

const router = express.Router();

console.log("GOOGLE_CLIENT_ID BACKEND:", process.env.GOOGLE_CLIENT_ID);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post("/auth/google", async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: "Token no enviado" });
    }

    // 🔐 Verificar token de Google
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const { email, name, picture } = payload;

    // 🔎 Buscar o crear usuario
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        name,
        picture,
        provider: "google",
      });
    }

    // 🔑 Token propio
const token = jwt.sign(
  {
    id: user._id,
    email: user.email,
    name: user.name
  },
  process.env.JWT_SECRET,
  { expiresIn: "30m" }
);

    res.json({
      token,
      email: user.email,
    });

  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ error: "Error autenticando con Google" });
  }
});

module.exports = router;
