#!/usr/bin/env bash
# Inspección de SOLO LECTURA del VPS de ReQRdito. No modifica nada.
# Nunca imprime valores de .env (solo nombres de variables) ni datos de clientes.
# Uso: ssh root@<vps> 'bash -s' < scripts/vps/inspeccionar-vps.sh
set -u

echo "== Sistema"
uname -sr; . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
echo "node $(node -v 2>/dev/null || echo no)"; echo "npm $(npm -v 2>/dev/null || echo no)"

echo "== Herramientas"
for b in mongoexport mongodump mongosh mongo psql pg_dump nginx ffmpeg pm2 git; do
  printf "%-12s %s\n" "$b" "$(command -v $b >/dev/null 2>&1 && ($b --version 2>&1 | head -1) || echo 'no instalado')"
done
systemctl is-active mongod 2>/dev/null | sed 's/^/mongod local: /'
systemctl is-active postgresql 2>/dev/null | sed 's/^/postgresql local: /'

echo "== Procesos PM2 (nombre, estado, carpeta)"
pm2 jlist 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const p of JSON.parse(s))
console.log(`${p.name} | ${p.pm2_env.status} | ${p.pm2_env.pm_cwd} | ${p.pm2_env.pm_exec_path}`)}catch{console.log("sin pm2")}})'

APP="${APP_DIR:-}"
if [ -z "$APP" ]; then
  APP=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).find(x=>/reqrdito/i.test(x.name))||JSON.parse(s)[0];console.log(p.pm2_env.pm_cwd)}catch{}})')
fi
echo "== Carpeta del backend: ${APP:-no encontrada}"
[ -n "$APP" ] && [ -d "$APP" ] || exit 0
cd "$APP"

echo "== Código desplegado"
git log -1 --format='%h %ad %s' --date=short 2>/dev/null || echo "sin git"
git status --short 2>/dev/null | head -20
ls -1
echo "-- dependencias"; node -e 'const p=require("./package.json");console.log(Object.keys(p.dependencies||{}).join(", "))'

echo "== Variables definidas en .env (solo nombres)"
[ -f .env ] && grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env | tr -d '=' | sort | tr '\n' ' '; echo
[ -f .env ] && stat -c '.env permisos %a dueño %U' .env

echo "== Plantillas de email"
ls -la emails 2>/dev/null || echo "sin carpeta emails/"
[ -d emails ] && (cd emails && sha256sum *.html 2>/dev/null)
[ -d emails ] && for f in emails/*.html; do echo "-- $f variables: $(grep -oE '\{\{[A-Z0-9_]+\}\}' "$f" | sort -u | tr '\n' ' ')"; done

echo "== Archivos subidos (recuento y tamaño)"
for d in uploads/audio uploads/qr uploads/temp events/uploads data; do
  [ -d "$d" ] && printf "%-16s %6s archivos  %s\n" "$d" "$(find "$d" -type f | wc -l)" "$(du -sh "$d" | cut -f1)"
done

echo "== nginx (server_name, root, try_files, proxy_pass)"
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -f "$f" ] || continue
  echo "-- $f"
  grep -nE 'server_name|listen|root |try_files|location|proxy_pass|return 30|rewrite' "$f"
done

echo "== Respaldos existentes"
ls -la /root/backups 2>/dev/null | tail -10 || echo "sin /root/backups"
