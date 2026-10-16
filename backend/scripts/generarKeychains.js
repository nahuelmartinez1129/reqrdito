const mongoose = require("mongoose");
const Keychain = require("../models/Keychain");

require("dotenv").config();

async function generarKeychains() {

  await mongoose.connect(process.env.MONGO_URI);

  const cantidad = 100;

  for (let i = 0; i < cantidad; i++) {

    const qrId = "KEY" + Math.random().toString(36).substring(2, 8).toUpperCase();

    await Keychain.create({
      qrId
    });

    console.log("Creado:", qrId);

  }

  console.log("Llaveros generados");

  process.exit();

}

generarKeychains();
