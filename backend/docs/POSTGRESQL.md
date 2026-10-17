# ReQRdito · Base de datos PostgreSQL

El backend usa **PostgreSQL** como única base de datos, accedida con **Prisma ORM 7.10**
(generador `prisma-client-js` + driver adapter `@prisma/adapter-pg`). MongoDB/Mongoose
ya no se usan en el código.

Los archivos (audios, PNG de QR) siguen guardándose en disco (`uploads/audio`,
`uploads/qr`, `events/uploads`); la base solo guarda sus rutas públicas.

## Esquema

| Tabla | Para qué | Claves y restricciones |
|---|---|---|
| `users` | Personas identificadas por email (Google Sign-In o alta desde el panel de eventos) | PK `id` uuid · `email` único y en minúsculas (CHECK) · `google_id` único opcional |
| `recuerdos` | Recuerdo de audio; `id` es el `recuerdoId` público de URLs y QR | PK `id` uuid · FK `user_id` → users (RESTRICT) · `payment_id` único · CHECK nombre no vacío · índice (`user_id`, `pagado`, `created_at` desc) |
| `recuerdo_audios` | 1 audio (individual) o 2 (pareja/Duo) por recuerdo | FK `recuerdo_id` → recuerdos (CASCADE) · único (`recuerdo_id`, `orden`) · CHECK `orden` 1–2 |
| `keychains` | Llaveros físicos con QR impreso | PK `qr_id` · FK única `recuerdo_id` → recuerdos (SET NULL) · CHECK `escaneos >= 0` · CHECK vinculado ⇒ `usado` |
| `events` | Eventos creados desde el panel para un cliente | PK `id` uuid · FK `user_id` → users (RESTRICT) |
| `event_qrs` | QR por invitado de un evento | PK `qr_id` uuid · FK `event_id` → events (CASCADE) · índices por evento y estado |
| `pagos_revision` | Pagos aprobados que no se aplicaron (importe, moneda, duplicado…) o aplicados sin importe registrado | PK `id` uuid · único (`payment_id`, `motivo`) · FK `recuerdo_id` → recuerdos (SET NULL) |

Enums: `Pack` (`individual`, `pareja`) y `EventQrStatus` (`empty`, `completed`).

No hay tabla de sesiones: la sesión es un JWT propio firmado tras validar el token de Google.
Cada recuerdo tiene a lo sumo un pago aprobado (`pagado`, `payment_id`, `payer_email`,
`pagado_en`, `monto_pagado`). Al crear la preferencia se guarda `monto_esperado` y `moneda`;
el webhook valida el pago real contra esos valores. El email de pago es durable
(`email_pago_enviado_en`, `email_pago_intento_en`, `email_pago_intentos`).
Los precios viven **solo** en `config/precios.js` (Individual 11.990 ARS · Dúo 21.990 ARS).
`keychains.pendiente_impresion` reemplaza la lista en memoria del panel de llaveros.

Datos derivados que **ya no se duplican**: el nombre y el audio de un llavero salen del
recuerdo vinculado, y el dueño/email de un QR de evento sale del evento.

## Variables de entorno

Ver `.env.example` (todas documentadas, sin valores). `server.js` valida al arrancar y no
imprime valores. Obligatorias: `DATABASE_URL`, `JWT_SECRET` (≥32), `GOOGLE_CLIENT_ID`,
`MP_ACCESS_TOKEN`; en producción además `NODE_ENV=production`, `ADMIN_EMAILS`, `BREVO_PASS`.
Opcionales: `PORT`, `FRONTEND_URL`, `API_URL`, `QR_RECUERDO_BASE`, `CORS_ORIGINS`,
`JWT_EXPIRES_IN`, `EVENTS_ENABLED`, `EMAIL_ENABLED`, `BREVO_USER`.
`TEST_DATABASE_URL` y `ALLOW_TEST_DB_RESET` solo para tests.
`MONGO_URI` ya no se usa en el código; conservarla solo hasta terminar la migración histórica.

## Comandos

```bash
npm install            # instala y ejecuta `prisma generate` (postinstall)
npm run db:migrate     # aplica migraciones pendientes (prisma migrate deploy)
npm run db:status      # estado de migraciones
npm start              # arranca la API (verifica PostgreSQL antes de escuchar)
npm run check          # verificaciones NO destructivas (sintaxis, prisma validate)
npm run test:unit      # tests sin base de datos
npm test               # recrea la base de PRUEBAS, migra desde cero y corre todo
npm run db:reconciliar # inventario histórico (solo lectura) / importación (ver DATOS_HISTORICOS.md)
npm run emails:pendientes  # lista emails de pago pendientes (-- --enviar para enviarlos)
```

`npm test` exige `TEST_DATABASE_URL` hacia una base **local** llamada `reqrdito_test[_sufijo]`,
distinta de `DATABASE_URL`, con un rol sin superusuario (`scripts/sql/crear-base-test.sql`), y
`ALLOW_TEST_DB_RESET=yes` en la terminal. El script muestra el destino y la borra completa. Google, Mercado Pago, el envío de emails y ffmpeg se
simulan: los tests no hacen llamadas externas ni mandan correos.

### Crear una migración nueva

1. Editar `prisma/schema.prisma`.
2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<fecha>_<nombre>/migration.sql`
   (o `npx prisma migrate dev --name <nombre>` si el rol tiene permiso para crear la shadow database).
3. Revisar el SQL, correr `npm test` y versionar la carpeta.

No hay seed: el sistema funciona con la base vacía. Administración: no hay tabla de roles;
los paneles exigen sesión de Google con un email incluido en `ADMIN_EMAILS`.

## Salud

`GET /api/health` → `200 {"ok":true,"db":"postgresql"}` o `503` si la base no responde.

## Despliegue en el VPS (resumen)

Ver la sección "Plan de despliegue" del informe de la migración. Reglas:

- Base y rol dedicados (`reqrdito` / `reqrdito_app`), sin superusuario, sin `CREATEDB`.
- Contraseña cargada con `\password` en `psql` y escrita en `.env` con `read -s`
  (nunca en la línea de comandos ni en el historial). `.env` con permisos `600`.
- Antes de reiniciar: respaldo del directorio del backend (sin `uploads/`) y del `.env`.
- Reiniciar solo `pm2 restart reqrdito-backend` y validar con `/api/health` + logs.

## Reversión

1. `pm2 stop reqrdito-backend`
2. Restaurar el código anterior desde el respaldo (tar) y el `.env` anterior (con `MONGO_URI`).
3. `npm ci` y `pm2 start reqrdito-backend` (o `pm2 restart`).
4. Verificar `https://api.reqrdito.com`.

MongoDB no se borra durante la migración, por lo que la reversión vuelve al estado previo.
Lo creado en PostgreSQL mientras estuvo activo **no** se copia de vuelta a MongoDB.

## Mantenimiento

- Respaldo: `pg_dump -Fc -d reqrdito -f /root/backups/reqrdito-$(date +%F).dump`
  (programarlo con cron y copiarlo fuera del VPS). Los audios de `uploads/` se respaldan aparte.
- Restauración: `pg_restore --clean -d reqrdito <archivo>.dump`.
