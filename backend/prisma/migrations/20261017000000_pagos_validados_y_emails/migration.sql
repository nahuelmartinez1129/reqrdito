-- Migración aditiva: no modifica ni borra datos existentes.
-- Agrega el importe esperado por preferencia, el estado durable del email de pago,
-- la tanda de impresión de llaveros y el registro de pagos para revisión.
-- AlterTable
ALTER TABLE "keychains" ADD COLUMN     "pendiente_impresion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "recuerdos" ADD COLUMN     "email_pago_enviado_en" TIMESTAMPTZ(6),
ADD COLUMN     "email_pago_intento_en" TIMESTAMPTZ(6),
ADD COLUMN     "email_pago_intentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moneda" VARCHAR(3),
ADD COLUMN     "monto_esperado" INTEGER,
ADD COLUMN     "monto_pagado" DECIMAL(12,2),
ADD COLUMN     "preferencia_creada_en" TIMESTAMPTZ(6),
ADD COLUMN     "preferencia_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "pagos_revision" (
    "id" UUID NOT NULL,
    "payment_id" VARCHAR(64) NOT NULL,
    "recuerdo_id" UUID,
    "motivo" VARCHAR(40) NOT NULL,
    "status" VARCHAR(40),
    "monto" DECIMAL(12,2),
    "moneda" VARCHAR(3),
    "monto_esperado" INTEGER,
    "external_reference" VARCHAR(128),
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pagos_revision_resuelto_created_at_idx" ON "pagos_revision"("resuelto", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_revision_payment_id_motivo_key" ON "pagos_revision"("payment_id", "motivo");

-- AddForeignKey
ALTER TABLE "pagos_revision" ADD CONSTRAINT "pagos_revision_recuerdo_id_fkey" FOREIGN KEY ("recuerdo_id") REFERENCES "recuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Restricciones de negocio que Prisma no expresa en el schema
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_monto_esperado_chk" CHECK ("monto_esperado" IS NULL OR "monto_esperado" > 0);
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_moneda_chk" CHECK ("moneda" IS NULL OR "moneda" ~ '^[A-Z]{3}$');
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_monto_pagado_chk" CHECK ("monto_pagado" IS NULL OR "monto_pagado" > 0);
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_email_pago_intentos_chk" CHECK ("email_pago_intentos" >= 0);
-- El email de pago solo puede figurar como enviado en un recuerdo pagado
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_email_pago_chk" CHECK ("email_pago_enviado_en" IS NULL OR "pagado");
