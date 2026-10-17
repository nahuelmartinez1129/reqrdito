# ReQRdito · Precio temporal de prueba

Sirve para hacer una compra real de control del pack **Individual** a un importe bajo
(por ejemplo ARS 100) sin cambiar el precio oficial en el código ni en la base.

## Precio original (no cambia)

`config/precios.js`: Individual **11.990 ARS** · Dúo **21.990 ARS**. El precio de prueba no
modifica esa tabla: es una excepción que el backend aplica solo mientras se cumplen todas
las condiciones.

## Condiciones (todas obligatorias; si alguna falla se cobra el precio oficial)

| Condición | Detalle |
|---|---|
| Entorno | `NODE_ENV=production`. En desarrollo y tests nunca se aplica. |
| Pack | solo `individual`. El Dúo y cualquier otro pack siguen igual. |
| Importe | `PRECIO_PRUEBA_INDIVIDUAL_ARS`: entero, mayor a 0 y menor al oficial. |
| Vencimiento | `PRECIO_PRUEBA_HASTA`: ISO 8601 **con zona horaria**, futura, a no más de **72 h** de ahora. |
| Cuentas | `PRECIO_PRUEBA_EMAILS`: emails (separados por coma) de las cuentas de Google **dueñas del recuerdo**. Cualquier otra cuenta paga el oficial. |

## Alcance

- `GET /api/precios` sin sesión muestra siempre el precio oficial (caché pública). Con la sesión de
  una cuenta habilitada muestra el de prueba (`private, no-store`); `pago.html` envía la sesión.
- Lo que decide es el dueño del recuerdo verificado por el backend, no el email de quien paga en
  Mercado Pago ni nada que mande el navegador.
- `POST /api/crear-preferencia` cobra ese importe, lo guarda en `recuerdos.monto_esperado`
  y crea la preferencia con `expires: true` y `expiration_date_to` = fin de la ventana.
  Además deja en el log `⚠️ PRECIO DE PRUEBA: recuerdo <id> …`.
- El webhook valida contra `monto_esperado`: un recuerdo con preferencia de $100 solo se
  activa con un pago aprobado de exactamente 100 ARS, y uno con preferencia oficial no se
  activa con 100.
- Los recuerdos históricos (sin `monto_esperado`) siguen aceptando solo tarifas oficiales.
- No se modifican pagos ni recuerdos existentes. No hay cambios de base.
- Al arrancar, el backend avisa en el log si el precio de prueba está activo o configurado
  pero no aplicado (y el motivo).

## Activar (en el VPS, lo hace el operador)

Editar el `.env` de producción **sin reemplazarlo**, agregando tres líneas:
```
PRECIO_PRUEBA_INDIVIDUAL_ARS=100
PRECIO_PRUEBA_HASTA=2026-10-20T23:59:00-03:00
PRECIO_PRUEBA_EMAILS=<cuenta de Google con la que se crea el recuerdo de prueba>
```
Después `pm2 restart reqrdito-backend --update-env` y verificar:
```bash
pm2 logs reqrdito-backend --lines 30 | grep -i "precio de prueba"
curl -s https://api.reqrdito.com/api/precios   # sin sesión: 11990 y 21990 (no cambia para el público)
```

## Restaurar el precio normal

1. Borrar las tres líneas `PRECIO_PRUEBA_*` del `.env` de producción.
2. `pm2 restart reqrdito-backend --update-env`.
3. Verificar que el log de arranque **no** muestre "PRECIO DE PRUEBA" y que, con la sesión de la
   cuenta de prueba, `pago.html` muestre otra vez $11.990 ARS.

Aunque no se haga, al pasar `PRECIO_PRUEBA_HASTA` el backend vuelve solo al precio oficial,
y Mercado Pago deja de aceptar pagos de las preferencias de prueba. No hace falta otro despliegue.
No borrar el recuerdo ni el pago de la prueba: quedan como registro (`monto_pagado = 100`).

Consulta de control (solo lectura):
```sql
SELECT id, pack, monto_esperado, monto_pagado, pagado, payment_id, pagado_en
FROM recuerdos WHERE monto_esperado < 11990 OR monto_pagado < 6900;
```
