const express = require("express");
const router = express.Router();
const Keychain = require("../models/Keychain");


// =============================
// Verificar llavero (activar)
// =============================
router.get("/activar", async (req, res) => {

  try {

    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ error: "QR inválido" });
    }

    const keychain = await Keychain.findOne({ qrId: key });

    if (!keychain) {
      return res.status(404).json({ error: "Este llavero no existe" });
    }

    res.json({
      success: true,
      qrId: keychain.qrId,
      usado: keychain.usado,
      pack: keychain.pack,
      audioUrl: keychain.audioUrl || null,
      nombreRecuerdo: keychain.nombreRecuerdo || null
    });

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: "Error del servidor" });

  }

});


// =============================
// Obtener datos del llavero
// =============================
router.get("/:key", async (req, res) => {

  try {

    const { key } = req.params;

    const keychain = await Keychain.findOne({ qrId: key });

    if (!keychain) {
      return res.status(404).json({
        error: "Llavero no encontrado"
      });
    }

    res.json(keychain);

  } catch (error) {

    console.error(error);
    res.status(500).json({
      error: "Error del servidor"
    });

  }

});


// =============================
// Ruta inteligente del QR
// =============================
router.get("/r/:id", async (req,res)=>{

try{

const { id } = req.params;

const keychain = await Keychain.findOne({ qrId:id });

if(!keychain){
 return res.status(404).send("QR no existe");
}


// ✅ contar escaneos
keychain.escaneos += 1;
await keychain.save();


if(!keychain.usado){

return res.redirect(
 `https://www.reqrdito.com/activar.html?key=${id}`
);

}

return res.redirect(
 `https://www.reqrdito.com/recuerdo.html?id=${keychain.recuerdoId}`
);

}catch(err){

console.error(err);
res.status(500).send("Error servidor");

}

});


module.exports = router;
