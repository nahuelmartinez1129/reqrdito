# ReQRdito · Datos históricos y migración desde MongoDB

Estado al 2026-10-17: **migración real PENDIENTE**. PostgreSQL local está vacío
(solo esquema). Los datos históricos viven en **MongoDB Atlas** (`MONGO_URI` del
`.env` anterior) y en los archivos de `uploads/`.

## Inventario verificado (solo lectura)

| Fuente | Contenido | Estado |
|---|---|---|
| `uploads/audio/` | 30 MP3 (≈0,41 MB) | conservados, sin tocar |
| `uploads/qr/` | 29 PNG (≈0,05 MB) | conservados, sin tocar |
| `uploads/temp/` | vacío | — |
| `events/uploads/` | 45 audios de eventos (webm/mp3) | conservados (módulo deshabilitado) |
| `data/recuerdos.json` | 4 registros, todos `pendiente_pago`, sin dueño ni pack | conservados, **no se importan** |
| PostgreSQL `reqrdito` | 0 filas en todas las tablas | esquema al día (2 migraciones) |
| MongoDB Atlas | colecciones `users`, `recuerdos`, `keychains` (+ eventos) | **sin export todavía** |

Correlación de archivos: 29 pares audio+QR comparten el UUID del recuerdo (formato
de nombres del flujo anterior) y 1 audio no tiene QR. De los 59 archivos, solo 8
están referenciados por `data/recuerdos.json`; los otros **51 pertenecen casi seguro a
recuerdos que solo existen en MongoDB**. Hasta importar ese export, los QR impresos
de esos recuerdos darían 404 contra el backend PostgreSQL.

`node scripts/migracion/reconciliar.js` regenera este inventario y lo guarda en
`backend/migracion-historica/` (carpeta ignorada por Git).

### Los 4 registros de `data/recuerdos.json`

Campos: `id` (UUID), `nombre`, `archivo` (`<id>.mp3`), `qr` (`<id>.png`), `estado`
(`pendiente_pago`), `creado` (2026-01-05). No tienen email de dueño ni pack. Los 4
tienen su audio y su QR en disco. No se importan porque no hay forma segura de asignarles
dueño ni estado de pago: quedan como referencia en el archivo (que se conserva) y
`routes/public.js` (legacy, no montado) sigue documentando cómo se leían.

## Procedimiento de migración (cuando esté el export)

1. **Congelar escrituras en Mongo** (ventana de corte): mientras el VPS siga en la
   versión Mongo, todo export queda viejo en el momento en que entra un recuerdo nuevo.
2. Exportar (desde el VPS o una PC con MongoDB Database Tools), **solo lectura**:
   ```bash
   for c in users recuerdos keychains; do
     mongoexport --uri "$MONGO_URI" --collection $c --jsonArray --out export/$c.json
   done
   ```
   Guardar `export/` fuera del repositorio (tiene datos personales).
3. Respaldar PostgreSQL: `pg_dump -Fc -d reqrdito -f reqrdito-antes-import.dump`.
4. Simular: `node scripts/migracion/reconciliar.js --dir export` → revisar el informe
   (importados / existentes / omitidos / errores / avisos de archivos faltantes).
5. Aplicar: `node scripts/migracion/reconciliar.js --dir export --aplicar`.
   Es idempotente: se puede repetir; lo que ya existe en PostgreSQL se omite y nunca se modifica.
6. Verificar con el bloque `verificacion` del informe (recuentos de users, recuerdos,
   pagados, audios, llaveros vinculados) contra los recuentos de Mongo
   (`db.recuerdos.countDocuments({pagado:true})`, etc.) y abrir 3 o 4 QR reales.
7. Recién entonces cortar el tráfico a la versión PostgreSQL.

### Reglas de mapeo

| Mongo | PostgreSQL | Regla |
|---|---|---|
| `users.email` | `users.email` | normalizado a minúsculas; si ya existe se omite |
| `users.googleId` | `users.google_id` | solo si ningún otro usuario lo tiene |
| `recuerdos.recuerdoId` | `recuerdos.id` | debe ser UUID; si no, error (se reporta) |
| `recuerdos.userEmail` (o `email`) | `recuerdos.user_id` | sin dueño → se omite; dueño sin documento en `users` → se crea el usuario solo con su email (igual que hacía el panel de eventos) |
| `audios[]` / `audioUrl` | `recuerdo_audios` | orden 1–2; archivos faltantes se reportan como aviso |
| `pagado`, `payment_id` | igual | se conservan tal cual; `payment_id` repetido → error |
| — | `monto_esperado` | **NULL**: a los históricos no se les aplica la tarifa nueva |
| — | `email_pago_enviado_en` | = fecha original si estaba pagado (no se reenvían emails a clientes históricos) |
| `keychains` | `keychains` | vinculado pero `usado=false`, recuerdo inexistente o ya vinculado → **no se importa**, se reporta para decisión manual |

Eventos (`events`, QR de eventos) no se importan: el módulo está deshabilitado.

## Pagos históricos y nuevas tarifas

- Los recuerdos ya pagados no se modifican.
- Preferencias creadas **antes** de este cambio (sin `monto_esperado`) y pagadas después:
  se acepta la tarifa anterior (6.900 / 10.900) o la vigente (11.990 / 21.990) **del mismo
  pack**, y el pago queda anotado en `pagos_revision` con motivo `sin_monto_registrado`.
- Cualquier otro importe o moneda no marca el recuerdo como pagado y queda en
  `pagos_revision` (`importe_incorrecto`, `moneda_incorrecta`, `pago_duplicado`, …).

Consulta de revisión: `SELECT * FROM pagos_revision WHERE NOT resuelto ORDER BY created_at;`

## Verificaciones del 2026-10-17 (segunda etapa)

- **`uploads/` local NO es el de producción.** Los 29 PNG de `uploads/qr` se decodificaron:
  los 29 apuntan a `http://localhost:5000/r/<id>` (primer commit de desarrollo, `93a5118`,
  ruta legacy `routes/public.js`). Son datos de desarrollo. Los audios y QR reales de clientes
  están en el VPS: la simulación de archivos debe correrse allá (o con una copia de su `uploads/`).
- **Formatos de QR por versión:**
  | Origen | Contenido del QR | Resolución hoy en producción | Con la versión nueva |
  |---|---|---|---|
  | `93a5118` (desarrollo) | `http://localhost:5000/r/<id>` | no aplica (nunca público) | no aplica |
  | recuerdos `552c30a`+ | `https://reqrdito.com/recuerdo.html?id=<uuid>` | 200 (página) → API | igual (`QR_RECUERDO_BASE`) |
  | llaveros, `scripts/generarQR.js` | `https://reqrdito.com/activar?key=<código>` | **404 (nginx no resuelve `/activar` sin `.html`)** | requiere ajuste de nginx (ver AUDITORIA) |
  | llaveros, PDF del panel | `https://api.reqrdito.com/api/keychain/r/<código>` | ruta existe (404 solo si el código no existe) | igual |
- **Atlas:** el `MONGO_URI` del `.env` local (idéntico al de `.env.backup`) es rechazado por Atlas
  (`bad auth`): credenciales viejas o rotadas. La exportación se hace con el `MONGO_URI` vigente del VPS.
- Herramienta de exportación: `scripts/migracion/exportarMongo.js` (driver oficial `mongodb@6.9.0`,
  solo `find`, manifiesto SHA-256, no sobrescribe). No depende de `mongoexport`.
