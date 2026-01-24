const mongoose = require("mongoose");

const RecuerdoSchema = new mongoose.Schema({
  recuerdoId: {
    type: String,
    required: true,
    unique: true,
  },

  nombre: String,
  audioUrl: String,
  qrUrl: String,

  pagado: {
    type: Boolean,
    default: false,
  },

  payment_id: String,
  email: String,        // email de Mercado Pago
  userEmail: String,    // 👈 dueño del recuerdo (Google login)

  creadoEn: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Recuerdo", RecuerdoSchema);
