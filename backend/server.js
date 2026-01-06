require("dotenv").config();

const express = require("express");
const cors = require("cors");

const uploadRoutes = require("./routes/upload");
const pagoRoutes = require("./routes/pago");
const publicRoutes = require("./routes/public");


const app = express();

app.use(cors());
app.use(express.json());



// 👉 rutas API
app.use("/api", uploadRoutes);
app.use("/api", pagoRoutes);

// 👉 rutas públicas (QR)
app.use("/", publicRoutes);

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
