const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const { sendEmail } = require("../services/emailService");

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({ error: "Token no enviado" });
    }

    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const user = {
      email: payload.email,
      name: payload.name,
    };

    const token = jwt.sign(user, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({ authToken: token });

    // 📩 Email bienvenida
    sendEmail(
      user.email,
      "Un lugar para guardar lo que importa",
      "bienvenida.html"
    );

  } catch (err) {
    console.error("❌ ERROR AUTH GOOGLE:", err);
    res.status(401).json({ error: "Token inválido" });
  }
});

module.exports = router;
