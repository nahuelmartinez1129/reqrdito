# ReQRdito · Auditoría y estabilización (2026-10-17)

Respaldo previo a los cambios: `C:\Users\matia\reqrdito-backups\2026-10-17\`
(parches de Git, `archivos.tar` con archivos nuevos/modificados + `uploads/` + `data/`,
sin `.env*` ni `node_modules`; verificable con `sha256sum -c SHA256SUMS.txt`).

## Compatibilidad frontend ↔ backend

| Pantalla | Endpoints | Sesión | Notas |
|---|---|---|---|
| `index.html` | `POST /api/auth/google` | guarda `authToken` + `loginTime` | sin precios visibles |
| `crear-recuerdo.html` | `POST /api/upload[?key=]` (multipart `nombre`, `pack`, `audio1`, `audio2`) | Bearer `authToken` | errores `{error}` 400/403/413/422 se muestran |
| `pago.html` | `GET /api/precios`, `GET /api/recuerdo/:id`, `POST /api/crear-preferencia {recuerdoId}` | Bearer | muestra `$11.990 ARS` / `$21.990 ARS`; nunca envía importes |
| `pago-exito.html` | — (lee `external_reference`) | — | back_url success |
| `error.html` / `pago-pendiente.html` | — | — | back_url failure / pending |
| `recuerdo.html` | `GET /api/recuerdo/:id`, `/audio/*`, `/qr/*` | — | eventos: `/events/qr-data/:id` (503 con el módulo apagado) |
| `mis-recuerdos.html` | `GET /api/mis-recuerdos`, `PUT/DELETE /api/recuerdos/:id`, `POST /api/recuerdos/:id/reenviar-mail`, `GET /api/descargar-qr/:id` | Bearer | contenido escapado (XSS) |
| `activar.html` | `POST /api/auth/google`, `GET /api/keychain/activar?key=` | guarda `authToken` (antes `token`) | |
| `audio.html` | `GET /api/keychain/:key` | — | |
| `admin-keychains.html` | `/api/keychain-admin/*` | Bearer de un email en `ADMIN_EMAILS` | login de Google agregado |
| QR impresos | `https://reqrdito.com/recuerdo.html?id=` · `https://api.reqrdito.com/api/keychain/r/<código>` · `https://reqrdito.com/activar?key=` | — | los tres formatos siguen vigentes |

Errores: siempre JSON `{ "error": "..." }`, sin stack. Token: JWT HS256 `{id,email,name}`,
vence a los 30 min (`JWT_EXPIRES_IN`). Rutas no montadas (legacy, conservadas):
`routes/auth.js`, `routes/public.js`. `POST /api/recuerdo` responde 410.
Scripts frontend sin uso (no incluidos por ninguna página): `js/auth-utils.js`, `js/login-recuerdos.js`.

## Módulo de eventos

Deshabilitado con `EVENTS_ENABLED=false` (por defecto): `/events/*`, `/events-admin/*`,
`/events-public/*` responden 503. Se conservan archivos, `events/uploads/`, tablas
`events`/`event_qrs` y migraciones; `mis-recuerdos` deja de listar QR de eventos (los datos
siguen en la base). Para reactivarlo: `EVENTS_ENABLED=true` + reinicio; el panel exige un
email de `ADMIN_EMAILS` y las rutas de invitados (`/r`, `/qr-data`, `/qr/:id/audio`, `/audio`)
quedan públicas. Pendiente antes de reactivar: nombres de archivo por `Date.now()` (colisión
posible), sin limpieza del archivo si falla la base, y `DELETE /events/qr/:id` borra un
recuerdo con el mismo id.

## Despliegue en el VPS (cuando la migración histórica esté verificada)

```bash
# 0. Ventana de corte: congelar escrituras en la versión Mongo
pm2 stop reqrdito-backend
# 1. Respaldos
tar czf /root/backups/reqrdito-backend-$(date +%F).tgz --exclude=node_modules --exclude=uploads /ruta/backend
cp /ruta/backend/.env /root/backups/env-$(date +%F) && chmod 600 /root/backups/env-*
pg_dump -Fc -d reqrdito -f /root/backups/reqrdito-$(date +%F).dump
# 2. Código nuevo (sin pisar .env, uploads/ ni emails/ existentes del VPS)
# 3. .env: NODE_ENV=production, ADMIN_EMAILS, EVENTS_ENABLED=false, BREVO_USER/BREVO_PASS
npm ci
npm run db:migrate && npm run db:status
npm run check
# 4. Migración histórica (docs/DATOS_HISTORICOS.md) y verificación de recuentos
pm2 start reqrdito-backend   # o pm2 restart
curl -s https://api.reqrdito.com/api/health
curl -s https://api.reqrdito.com/api/precios
pm2 logs reqrdito-backend --lines 50
```
Si en el VPS existen `emails/bienvenida.html` o `emails/recuerdo-creado.html` propios,
compararlos con los del repositorio antes de reemplazarlos.

Cron sugerido para emails de pago pendientes: `*/15 * * * * cd /ruta/backend && node scripts/reenviarEmailsPagos.js --enviar`.

## Reversión

1. `pm2 stop reqrdito-backend`.
2. Restaurar el tar del código y el `.env` anterior.
3. `npm ci && pm2 start reqrdito-backend`; verificar `/api/health`.
4. La migración `20261017000000_pagos_validados_y_emails` es aditiva: el código anterior
   (PostgreSQL) funciona con esas columnas presentes; no hace falta revertirla. Si se
   vuelve a la versión Mongo, PostgreSQL queda intacto para reintentar.
5. Lo creado en PostgreSQL durante la ventana nueva no vuelve a Mongo.

## Hallazgo en producción: `/activar` sin `.html` da 404

`https://reqrdito.com/activar?key=…` (formato de `scripts/generarQR.js`) responde 404 hoy;
`/activar.html?key=…` funciona. Si hay llaveros impresos con ese formato, no abren.
Corrección propuesta (requiere autorización, cambio en nginx del VPS), en el `server` del frontend:
```nginx
location = /activar { return 302 /activar.html$is_args$args; }
```
Probar con `nginx -t` antes de `systemctl reload nginx`. No afecta otras rutas.
