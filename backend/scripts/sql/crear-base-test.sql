-- Crea la base de PRUEBAS de ReQRdito con un rol propio y sin privilegios.
-- Ejecutar UNA vez como superusuario (postgres).
--
-- NO modifica la base "reqrdito" ni sus permisos (versión anterior hacía REVOKE/GRANT;
-- se quitó). Qué hace cada instrucción:
--   1. \prompt          pide la contraseña del rol nuevo en la terminal (no queda en el historial).
--   2. CREATE ROLE      rol de login sin superusuario, sin crear bases/roles, sin replicación,
--                       sin saltear RLS. Solo podrá administrar la base de la que sea dueño.
--   3. CREATE DATABASE  base reqrdito_test, dueña el rol de pruebas (necesario para que
--                       scripts/test-reset-db.js pueda borrar/recrear su esquema public).
--   4. Verificación     confirma que el rol nuevo NO tiene privilegios sobre las tablas de
--                       reqrdito (puede abrir una conexión por el permiso CONNECT de PUBLIC,
--                       que es el de fábrica, pero no leer ni escribir nada).
--
-- PowerShell (escribí la contraseña cuando la pida; no la pegues en el chat):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -f backend\scripts\sql\crear-base-test.sql

\set ON_ERROR_STOP on
\prompt 'Contraseña NUEVA para el rol reqrdito_test_user: ' test_pw

CREATE ROLE reqrdito_test_user LOGIN PASSWORD :'test_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE DATABASE reqrdito_test OWNER reqrdito_test_user ENCODING 'UTF8' TEMPLATE template0;

\connect reqrdito
SELECT count(*) AS tablas_de_reqrdito_accesibles_para_el_rol_de_pruebas
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND (has_table_privilege('reqrdito_test_user', quote_ident(t.table_name), 'SELECT')
    OR has_table_privilege('reqrdito_test_user', quote_ident(t.table_name), 'INSERT,UPDATE,DELETE,TRUNCATE'));
-- Debe dar 0.

\echo 'Listo. Agregá TEST_DATABASE_URL en backend\.env con el editor (no en la terminal ni en el chat):'
\echo 'TEST_DATABASE_URL=postgresql://reqrdito_test_user:<contraseña>@127.0.0.1:5432/reqrdito_test'
