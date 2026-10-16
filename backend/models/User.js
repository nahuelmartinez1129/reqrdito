const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: String,

  email: {
    type: String,
    unique: true,
  },

  name: String,
  picture: String,


  recuerdos: [
    {
      tipo: String,
      ref: String
    }
  ]
});

module.exports = mongoose.model("User", UserSchema);
