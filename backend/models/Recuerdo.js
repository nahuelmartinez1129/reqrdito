const mongoose = require("mongoose");

const RecuerdoSchema = new mongoose.Schema({
  recuerdoId: { type: String, unique: true },

  nombre: String,

  pack: {
    type: String,
    enum: ["individual", "pareja"],
    default: "individual"
  },

  audios: [
    {
      url: String,
      orden: Number
    }
  ],

  // compatibilidad recuerdos viejos
  audioUrl: String,

  qrUrl: String,

  pagado: { type: Boolean, default: false },

  payment_id: String,
  email: String,
  userEmail: String,

  creadoEn: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Recuerdo", RecuerdoSchema);
