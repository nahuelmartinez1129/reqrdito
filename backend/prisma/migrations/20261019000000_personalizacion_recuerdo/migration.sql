-- Migración aditiva: no modifica ni borra datos existentes.
-- Personalización opcional de la página del QR: hasta 4 fotos, mensaje, fecha con contador y canción.
-- AlterTable
ALTER TABLE "recuerdos" ADD COLUMN     "cancion_url" VARCHAR(200),
ADD COLUMN     "fecha" DATE,
ADD COLUMN     "fecha_titulo" VARCHAR(60),
ADD COLUMN     "mensaje" VARCHAR(600);

-- CreateTable
CREATE TABLE "recuerdo_fotos" (
    "id" UUID NOT NULL,
    "recuerdo_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "orden" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recuerdo_fotos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recuerdo_fotos_recuerdo_id_orden_key" ON "recuerdo_fotos"("recuerdo_id", "orden");

-- AddForeignKey
ALTER TABLE "recuerdo_fotos" ADD CONSTRAINT "recuerdo_fotos_recuerdo_id_fkey" FOREIGN KEY ("recuerdo_id") REFERENCES "recuerdos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
