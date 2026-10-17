# ReQRdito · Pruebas locales (login, pagos de prueba y todo el sistema)

`npm run dev` levanta en tu PC:

| Qué | Dirección |
|---|---|
| Frontend | http://localhost:5500 |
| Backend (API) | http://localhost:5000 |
| Base de datos | `reqrdito_dev` (PostgreSQL local, **separada** de `reqrdito`) |
| Archivos subidos | `backend/uploads-dev/` (separada de `uploads/`) |

El frontend detecta que está en `localhost` (`frontend/js/config.js`) y usa la API local; en
`reqrdito.com` sigue usando `https://api.reqrdito.com`. Emails: se simulan (se muestran en la
consola del backend). Eventos: apagado.

**Protecciones:** `npm run dev` y `npm run dev:migrate` se niegan a arrancar si la base no es
local o no se llama `reqrdito_dev`, o si `NODE_ENV=production`. La base principal `reqrdito`
(con los datos históricos) y `uploads/` no se usan. Fuera de producción el backend no acepta la
credencial real de Mercado Pago (responde 503): solo credenciales de prueba.

## Preparación (una sola vez)

1. **Crear la base `reqrdito_dev`** (PowerShell, en `backend/`; pide la contraseña de `postgres`
   en la terminal):
   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f scripts/sql/crear-base-local.sql
   ```
   Crea una base vacía cuyo dueño es `reqrdito_app`. No crea roles ni cambia permisos.

2. **`backend/.env.local`** ya está creado (no se versiona): misma conexión que `.env` pero con la
   base `reqrdito_dev`, direcciones locales y `UPLOADS_DIR=uploads-dev`. La plantilla documentada
   es `.env.local.example`.

3. **Aplicar el esquema** a `reqrdito_dev` (solo agrega tablas, nunca borra):
   ```powershell
   npm run dev:migrate
   ```

4. **Instalar ffmpeg** (convierte los audios subidos a MP3; sin él, crear un recuerdo falla):
   ```powershell
   winget install Gyan.FFmpeg
   ```
   Cerrar y reabrir la terminal. Si queda fuera del PATH, poner la ruta en `.env.local`:
   `FFMPEG_PATH=C:\ruta\a\ffmpeg.exe`. `npm run dev` avisa si no lo encuentra.

5. **Google (login)**: en Google Cloud Console → *APIs y servicios* → *Credenciales* → el cliente
   OAuth que usa ReQRdito → *Orígenes autorizados de JavaScript*, agregar:
   - `http://localhost:5500`
   - `http://localhost`

   (No cambia credenciales; los cambios pueden tardar unos minutos en aplicarse.)

6. **Mercado Pago (pagos de prueba)**: en *Tus integraciones* → tu aplicación → *Cuentas de
   prueba*, crear una cuenta **vendedora** y una **compradora**. Iniciar sesión en Mercado Pago
   Developers con la vendedora de prueba, crear una aplicación y copiar su Access Token de
   producción (`APP_USR-…`, que al ser de una cuenta de prueba no mueve dinero real). Pegarlo en
   `backend/.env.local` (con un editor, no en el chat):
   ```
   MP_ACCESS_TOKEN=APP_USR-...   # de la cuenta VENDEDORA DE PRUEBA
   ```
   El backend verifica con Mercado Pago que la cuenta sea de prueba; si es tu cuenta real, bloquea.
   También sirve una credencial `TEST-…` de tu cuenta.

## Uso diario

```powershell
cd backend
npm run dev
```
Abrir http://localhost:5500. Para cortar: `Ctrl + C` en esa terminal.

## Qué probar

| Flujo | Cómo |
|---|---|
| Login | Botón de Google en el inicio o en "Crear recuerdo" (con el origen agregado en el paso 5). |
| Crear recuerdo sin sesión | Cargar nombre y audio → "Continuar" → iniciar sesión en el modal → sigue solo y lleva al pago. |
| Pago aprobado | En `pago.html` → "Pagar" → en Mercado Pago, en una **ventana de incógnito**, tarjeta de prueba con titular `APRO` (DNI 12345678), CVV 123, venc. 11/30. Visa crédito `4509 9535 6623 3704` · Mastercard débito `5287 3383 1025 3304`. |
| Pago rechazado / pendiente | Mismo flujo con titular `OTHE` (rechazado) o `CONT` (pendiente): el recuerdo NO se activa. |
| Confirmación del pago | Ver "Cómo se confirma un pago en local" (abajo). El recuerdo se activa solo cuando el backend consulta el pago en Mercado Pago y está aprobado, con el importe y la moneda esperados. |
| Mis recuerdos | Ver, copiar link, renombrar, reenviar email, descargar QR, eliminar. |
| Llaveros | Con un email de `ADMIN_EMAILS` (el de `.env`): http://localhost:5500/admin-keychains.html → generar llaveros → abrir `http://localhost:5500/activar?key=<código>`. |
| Emails | Con `EMAIL_ENABLED=false` se muestran como `✉️ [simulado]` y quedan pendientes; con `EMAIL_ENABLED=true` se envían de verdad (Brevo, `BREVO_PASS` de `.env`) al email de la **cuenta de Google dueña del recuerdo** (no al de la compradora de Mercado Pago). |

Revisión de pagos dudosos (en `reqrdito_dev`):
`SELECT * FROM pagos_revision WHERE NOT resuelto ORDER BY created_at;`

### Cómo se confirma un pago en local

En producción Mercado Pago avisa al webhook (`notification_url`) y vuelve solo al sitio
(`auto_return`). **En local ninguna de las dos cosas es posible**: Mercado Pago no puede
llegar a `localhost` y rechaza `auto_return` con URLs `http://localhost` ("auto_return
invalid. back_url.success must be defined"). Por eso, después de pagar, **Mercado Pago no
vuelve solo al sitio**. Hay tres caminos, todos validados contra Mercado Pago:

1. **Conciliación automática (sin hacer nada):** `npm run dev` busca cada 20 s en Mercado Pago
   los pagos de las preferencias impagas de las últimas 24 h y los procesa. En la consola:
   `💳 Pago <id> [conciliacion] → pagado · estado=approved …`.
2. **"Volver al sitio"** en la pantalla de Mercado Pago: `pago-exito.html` muestra "Confirmando tu
   pago…", avisa al webhook local con el `payment_id`, consulta al backend y **recién cuando el
   recuerdo figura pagado** dice "¡Pago confirmado!" y redirige al recuerdo. Si no llega la
   confirmación en 1 minuto, lo indica sin dar el pago por aprobado.
3. **A mano:** `npm run pagos:conciliar -- --local` (simulación) y
   `npm run pagos:conciliar -- --local --aplicar` (procesa los aprobados).

Emails de pago pendientes (por ejemplo si el pago se confirmó con `EMAIL_ENABLED=false`):
```powershell
npm run emails:pendientes -- --local            # lista
npm run emails:pendientes -- --local --enviar   # los envía (requiere EMAIL_ENABLED=true)
```
Sin `--local` estos scripts se niegan a correr fuera de producción (no tocan `reqrdito`).

Registros de diagnóstico en la consola del backend (sin tokens ni emails completos):
`📨 Webhook …`, `💳 Pago <id> [webhook|conciliacion] → <resultado> · estado=… detalle=… recuerdo=…`,
`✉️ Email de pago <recuerdo> → a***@dominio: enviado|simulado|error (…)`.

### Webhook real de Mercado Pago (opcional)

Para probar el webhook tal como en producción, exponer el backend con un túnel HTTPS
(por ejemplo `cloudflared tunnel --url http://localhost:5000`) y en `.env.local`:
```
MP_NOTIFICATION_URL=https://<tu-tunel>/api/webhook
```
(Con `MP_NOTIFICATION_URL` definida, `npm run dev` no concilia automáticamente.)
También se puede avisar a mano un pago (el backend igual lo valida contra Mercado Pago):
```powershell
curl.exe -X POST "http://localhost:5000/api/webhook?type=payment&data.id=<payment_id>"
```

### Notas

- No usar a la vez Live Server de VS Code y `npm run dev` en el puerto 5500: los dos pueden
  quedar escuchando y no queda claro cuál responde. Cerrar Live Server.
- El QR de los recuerdos creados en local apunta a `http://localhost:5500/recuerdo.html?id=…`
  (`QR_RECUERDO_BASE`): sirve en la PC, no desde el celular.
- Si el puerto 5000 está ocupado, cambiar `PORT` en `.env.local` y, en la consola del navegador
  (en http://localhost:5500): `localStorage.setItem("reqrditoApiLocal", "http://localhost:<puerto>")`.
- Para empezar de cero se puede borrar y recrear **solo** `reqrdito_dev` (nunca `reqrdito`).
