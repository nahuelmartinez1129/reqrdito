-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Pack" AS ENUM ('individual', 'pareja');

-- CreateEnum
CREATE TYPE "EventQrStatus" AS ENUM ('empty', 'completed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "google_id" VARCHAR(255),
    "name" VARCHAR(255),
    "picture" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recuerdos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "pack" "Pack" NOT NULL DEFAULT 'individual',
    "qr_url" TEXT,
    "pagado" BOOLEAN NOT NULL DEFAULT false,
    "payment_id" VARCHAR(64),
    "payer_email" VARCHAR(320),
    "pagado_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recuerdos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recuerdo_audios" (
    "id" UUID NOT NULL,
    "recuerdo_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "orden" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recuerdo_audios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keychains" (
    "qr_id" VARCHAR(32) NOT NULL,
    "pack" "Pack" NOT NULL DEFAULT 'individual',
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "recuerdo_id" UUID,
    "escaneos" INTEGER NOT NULL DEFAULT 0,
    "activado_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keychains_pkey" PRIMARY KEY ("qr_id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_qrs" (
    "qr_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL DEFAULT 'Invitado',
    "audio_url" TEXT NOT NULL DEFAULT '',
    "status" "EventQrStatus" NOT NULL DEFAULT 'empty',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_qrs_pkey" PRIMARY KEY ("qr_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "recuerdos_payment_id_key" ON "recuerdos"("payment_id");

-- CreateIndex
CREATE INDEX "recuerdos_user_id_pagado_created_at_idx" ON "recuerdos"("user_id", "pagado", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "recuerdo_audios_recuerdo_id_orden_key" ON "recuerdo_audios"("recuerdo_id", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "keychains_recuerdo_id_key" ON "keychains"("recuerdo_id");

-- CreateIndex
CREATE INDEX "events_user_id_idx" ON "events"("user_id");

-- CreateIndex
CREATE INDEX "event_qrs_event_id_idx" ON "event_qrs"("event_id");

-- CreateIndex
CREATE INDEX "event_qrs_status_idx" ON "event_qrs"("status");

-- AddForeignKey
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuerdo_audios" ADD CONSTRAINT "recuerdo_audios_recuerdo_id_fkey" FOREIGN KEY ("recuerdo_id") REFERENCES "recuerdos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keychains" ADD CONSTRAINT "keychains_recuerdo_id_fkey" FOREIGN KEY ("recuerdo_id") REFERENCES "recuerdos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_qrs" ADD CONSTRAINT "event_qrs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restricciones de negocio que Prisma no expresa en el schema
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email"));
ALTER TABLE "recuerdos" ADD CONSTRAINT "recuerdos_nombre_chk" CHECK (length(btrim("nombre")) >= 1);
ALTER TABLE "recuerdo_audios" ADD CONSTRAINT "recuerdo_audios_orden_chk" CHECK ("orden" BETWEEN 1 AND 2);
ALTER TABLE "keychains" ADD CONSTRAINT "keychains_escaneos_chk" CHECK ("escaneos" >= 0);
ALTER TABLE "keychains" ADD CONSTRAINT "keychains_vinculo_chk" CHECK ("recuerdo_id" IS NULL OR "usado");
