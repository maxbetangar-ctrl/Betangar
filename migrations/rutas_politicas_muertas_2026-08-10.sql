-- Las políticas `chofer_anon_*` de `rutas`/`rutas_estado` no las usa NADIE: se
-- comprobó en los tres clones que `chofer.html` nunca toca esas tablas — solo
-- `app.js`, la oficina autenticada. Son restos de algo que no llegó a usarse.
--
-- La auditoría lo reportó como «falta el grant» (betangar/rutas_estado/
-- grant-anon-ausente). El arreglo correcto es el contrario: **sobra la política**.
-- Dar el permiso habría abierto a `anon` una tabla que nadie anónimo consulta.
--
-- Las políticas son de rol {anon}, separadas de las de `authenticated`: la
-- oficina no pierde nada.
begin;
drop policy if exists chofer_anon_insert on public.rutas_estado;
drop policy if exists chofer_anon_select on public.rutas_estado;
drop policy if exists chofer_anon_update on public.rutas_estado;
do $$
declare n int;
begin
  select count(*) into n from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace ns on ns.oid=c.relnamespace
   where ns.nspname='public' and c.relname='rutas_estado'
     and 'anon' = any(p.polroles::regrole[]::text[]);
  if n > 0 then raise exception 'Quedan % políticas de anon sobre rutas_estado', n; end if;
  raise notice 'OK: rutas_estado sin políticas muertas.';
end $$;
commit;
