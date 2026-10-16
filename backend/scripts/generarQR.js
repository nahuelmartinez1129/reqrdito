const QRCode = require("qrcode");
const mongoose = require("mongoose");
const Keychain = require("../models/Keychain");
const fs = require("fs");

require("dotenv").config();

async function generarQR() {

  await mongoose.connect(process.env.MONGO_URI);

  const keychains = await Keychain.find();

  for (const key of keychains) {

    const url = `https://reqrdito.com/activar?key=${key.qrId}`;

    const filePath = `./qr/${key.qrId}.png`;

    await QRCode.toFile(filePath, url);

    console.log("QR creado:", key.qrId);

  }

  process.exit();

}

generarQR();
