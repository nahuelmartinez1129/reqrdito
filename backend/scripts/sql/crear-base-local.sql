-- Base de pruebas MANUALES local (npm run dev): reqrdito_dev.
--
-- Uso (PowerShell, en backend/; la contraseña de postgres se escribe en la terminal):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f scripts/sql/crear-base-local.sql
--
-- - Crea una base NUEVA y vacía cuyo dueño es el rol de la app (reqrdito_app):
--   no crea roles, no pide contraseñas nuevas y no cambia permisos de ninguna base.
-- - No toca la base principal "reqrdito" ni sus datos históricos.
-- - Si reqrdito_dev ya existe, CREATE DATABASE falla y no se modifica nada.

\set ON_ERROR_STOP on

CREATE DATABASE reqrdito_dev OWNER reqrdito_app;

\echo 'Base reqrdito_dev creada (dueño: reqrdito_app). Siguiente paso: npm run dev:migrate'
