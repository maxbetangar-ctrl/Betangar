-- ═══════════════════════════════════════════════════════════════════════════════
-- EL MONTO DE UNA PLANILLA LO PONE LA BASE, NO EL NAVEGADOR — 2026-11-04
--
-- Máximo, 04/11/2026: «sigues sin resolver en todas las puntas que la nueva tarifa
-- es 32,65 la tonelada, 261,20 el viaje… en el reporte de viajes semanal que se le
-- envía a la Alcaldía sigue del primer lunes de octubre para acá los 316 el viaje».
--
-- 🔴 TENÍA RAZÓN, Y LA CAUSA NO ERA LA QUE YO HABÍA ARREGLADO.
--    A las 13:20 de hoy se corrigieron las 310 planillas desde el 05/10 y quedaron
--    TODAS a 261,20 — medido. A las 16:40 había otra vez planillas a **316,88**:
--    las del **01 y 02/11**, cargadas DESPUÉS de la corrección.
--
--    ⇒ No se escaparon de la corrección: **nacieron mal**. `app.js` ya valora por
--      fecha y está desplegado, pero el navegador de quien carga la planilla tenía
--      el código y la configuración viejos en caché. Mientras el monto lo calcule
--      el cliente, CUALQUIER pestaña vieja —o un Excel, o un script— puede volver a
--      escribir el precio equivocado, y nadie se entera hasta que el informe sale
--      a la Alcaldía con otro número.
--
-- ⛔ POR ESO EL ARREGLO NO ES OTRA CORRECCIÓN DE FILAS: es que la base DEJE DE
--    ACEPTAR un monto que no corresponde a la tarifa de esa fecha. `m` pasa a ser
--    un valor derivado que calcula la puerta, no un dato que manda quien escribe.
--    Una corrección que otro proceso puede deshacer sola no es una corrección.
--    [[norma-arreglar-el-mecanismo-no-el-caso]]
--    [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
-- ⚠️ Si `btg_tarifa_viaje(f)` no sabe la tarifa de esa fecha, NO se toca la fila:
--    un viaje sin tarifa no vale cero. [[norma-falta-de-dato-no-es-un-dato]]
--
-- ⛔ REVERSIBLE: UNDO al final. Lo corregido se respalda antes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) La puerta: el monto se calcula, no se recibe ───────────────────────────
create or replace function public.planilla_monto_por_tarifa() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
declare v_tarifa numeric;
begin
  v_tarifa := public.btg_tarifa_viaje(new.f::date);
  if v_tarifa is null then return new; end if;   -- sin tarifa declarada: no se inventa
  new.m := round(coalesce(new.t, 0) * v_tarifa, 2);
  return new;
end;
$$;

comment on function public.planilla_monto_por_tarifa() is
  'El monto de una planilla = viajes x la tarifa VIGENTE EL DIA DEL VIAJE. Lo pone la base para que ningun cliente -- una pestana con cache vieja, un Excel, un script -- pueda guardar otro precio. 04/11/2026: asi nacieron planillas a 316,88 tres horas despues de corregir todo a 261,20.';

drop trigger if exists trg_planilla_monto_por_tarifa on public.planillas;
create trigger trg_planilla_monto_por_tarifa
  before insert or update of t, f, m on public.planillas
  for each row execute function public.planilla_monto_por_tarifa();

-- ── 2) Respaldo de lo que haya quedado mal ────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_planillas_tarifa_2026-11-04b',
       coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'p', p.p, 'f', p.f, 't', p.t, 'm', p.m)
                          order by p.id)::text, '[]')
  from public.planillas p
 where public.btg_tarifa_viaje(p.f::date) is not null
   and p.m is distinct from round(coalesce(p.t,0) * public.btg_tarifa_viaje(p.f::date), 2)
on conflict (clave) do update set valor = excluded.valor, updated_at = now();

-- ── 3) Y se corrige TODO lo que no cuadre, de cualquier fecha ─────────────────
update public.planillas p
   set m = round(coalesce(p.t,0) * public.btg_tarifa_viaje(p.f::date), 2)
 where public.btg_tarifa_viaje(p.f::date) is not null
   and p.m is distinct from round(coalesce(p.t,0) * public.btg_tarifa_viaje(p.f::date), 2);

-- ── 4) Para poder mirarlo cuando se quiera ────────────────────────────────────
create or replace function public.btg_planillas_fuera_de_tarifa()
returns table (f text, cam text, p text, t int, m numeric, tarifa_guardada numeric, tarifa_que_toca numeric)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select pl.f, pl.cam, pl.p, pl.t, pl.m,
         round(pl.m / nullif(pl.t,0), 2),
         public.btg_tarifa_viaje(pl.f::date)
    from public.planillas pl
   where public.btg_tarifa_viaje(pl.f::date) is not null
     and pl.m is distinct from round(coalesce(pl.t,0) * public.btg_tarifa_viaje(pl.f::date), 2)
   order by pl.f desc;
$$;
revoke all on function public.btg_planillas_fuera_de_tarifa() from public, anon;
grant execute on function public.btg_planillas_fuera_de_tarifa() to authenticated, service_role;

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select case when f >= '2026-10-05' then 'desde 05/10' else 'hasta 04/10' end tramo,
       count(*) filas, sum(t) viajes, round(sum(m),2) monto,
       string_agg(distinct round(m/nullif(t,0),2)::text, ', ') tarifas
  from public.planillas group by 1 order by 1 desc;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   drop trigger if exists trg_planilla_monto_por_tarifa on public.planillas;
--   drop function if exists public.planilla_monto_por_tarifa();
--   drop function if exists public.btg_planillas_fuera_de_tarifa();
--   update public.planillas p set m = (b.v->>'m')::numeric
--     from (select jsonb_array_elements(valor::jsonb) v from public.configuracion
--            where clave = 'backup_planillas_tarifa_2026-11-04b') b
--    where p.id = (b.v->>'id')::bigint;
-- ═══════════════════════════════════════════════════════════════════════════════
