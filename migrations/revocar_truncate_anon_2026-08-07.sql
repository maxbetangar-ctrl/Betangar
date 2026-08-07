-- Quitar a anon/authenticated los privilegios que RLS NO cubre.
-- 2026-08-07 · aplicar en Principal, FLOTILLA, VIDECA y FlotaMax-DEMO.
--
-- QUÉ ES Y QUÉ NO ES
--   RLS filtra SELECT/INSERT/UPDATE/DELETE. NO filtra TRUNCATE: un rol con ese privilegio
--   vacía la tabla sin importar las políticas. Y el default de Supabase concede `arwdDxtm`
--   (la D es TRUNCATE) a anon y authenticated sobre toda tabla nueva del esquema public.
--
--   ⚠️ NO es un agujero abierto HOY, y conviene decirlo con precisión:
--     · `anon` y `authenticated` son NOLOGIN — nadie se conecta a Postgres con ellos;
--     · PostgREST no tiene verbo TRUNCATE;
--     · no hay ninguna función que trunque (verificado en las 4 bases: 0).
--   Es un privilegio LATENTE. Se cierra porque el día que alguien escriba una función
--   SECURITY INVOKER que limpie una tabla, el permiso ya está puesto y nadie lo va a mirar.
--   Defensa en profundidad, no emergencia.
--
--   REFERENCES y TRIGGER van en el mismo paquete: permiten colgar una FK o un trigger de una
--   tabla ajena, y ninguna app de navegador hace eso.
--
-- NO SE TOCAN select/insert/update/delete: son los que usan las apps y los gobierna RLS.
--
-- REVERSIBLE:  grant truncate, references, trigger on all tables in schema public to anon, authenticated;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- Y que las tablas NUEVAS no vuelvan a nacer con ellos (si no, esto se deshace solo con el
-- próximo `create table` — ver la norma del candado que otro paso deshace).
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
