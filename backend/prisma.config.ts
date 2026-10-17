import "dotenv/config";
import { defineConfig } from "prisma/config";

// Configuración del CLI de Prisma (migraciones, generate, validate).
// DATABASE_URL se toma del entorno o de backend/.env; nunca se escribe acá.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
