const mongoose = require("mongoose");

const KeychainSchema = new mongoose.Schema({

  qrId: {
    type: String,
    required: true,
    unique: true
  },

  pack: {
    type: String,
    enum: ["individual","pareja"],
    default: "individual"
  },

  usado: {
    type: Boolean,
    default: false
  },

  recuerdoId: {
    type: String,
    default: null
  },

  nombreRecuerdo: {        // nombre del recuerdo (ej: "Piki")
    type: String,
    default: null
  },

  escaneos: {              // cantidad de veces que se escaneo
    type: Number,
    default: 0
  },

  activadoEn: {            // fecha cuando se vincula a un recuerdo
    type: Date,
    default: null
  },

  creadoEn: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("Keychain", KeychainSchema);
