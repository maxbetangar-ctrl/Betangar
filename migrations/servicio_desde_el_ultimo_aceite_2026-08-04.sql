-- APP: grupo FlotaMax (Flotilla, VIDECA, FlotaMax demo) + Betangar — FECHA: 2026-08-04
--
-- EL MANTENIMIENTO PREVENTIVO NO MEDÍA LO QUE DECÍA MEDIR.
--
-- Buscando en los 9 productos el mismo hueco de `destinos.ult_entrega` apareció este, peor:
--
-- 1. `km_data` tiene DOS columnas para el mismo dato — `ultsrv` (integer) y `ult_srv` (numeric) — y
--    las dos estaban en 0 en las 19 unidades de Flotilla y las 13 de Betangar.
-- 2. La app ESCRIBE en `ultsrv` y LEE de `ult_srv`. Aunque se llenara, la pantalla no lo vería.
-- 3. Solo escribía si el nombre del trabajo contenía el texto «5000». Los tipos que la gente usa de
--    verdad son «Aceite de motor» y «Pulmon de Cabina»: nunca coincidía.
-- 4. Y el cálculo del próximo servicio ignoraba las dos columnas:
--        proxServicio(km) = (floor(km/5000)+1)*5000
--    o sea el siguiente múltiplo de 5.000 del KM ACTUAL, no del último servicio.
--
-- Lo que producía, con datos reales del 2026-08-04: el FC01 iba en 70.017 km con su último cambio de
-- aceite a los 65.652 (16/07) — **4.365 km recorridos, faltaban 635 para los 5.000** — y el tablero
-- lo mostraba en VERDE, «faltan 4.983 km». Ocho veces la realidad. Y como el próximo se recalcula
-- solo con el km actual, una unidad NUNCA aparece vencida: el número se reinicia cada 5.000 km haya
-- o no haya servicio.
--
-- ⚠️ EL SERVICIO SE IDENTIFICA POR `item_id`, NUNCA POR EL TEXTO DEL TIPO. Ese fue el error de
-- origen. En Betangar conviven «Aceite de motor» (item_id `aceite_motor`, ES el service), «Filtro de
-- aceite» (`filtro_aceite`, NO lo es) y «ACEITE DIESEL» (sin item_id, que es COMBUSTIBLE). Cualquier
-- match por la palabra «aceite» contaría los tres. `item_id` ya existía y estaba bien poblado: 2
-- registros en Flotilla y 12 en Betangar, todos con km.
--
-- Decisión de Máximo (2026-08-04): solo el cambio de aceite reinicia la cuenta, y el intervalo es
-- POR UNIDAD con 5.000 km de respaldo — una chuto no es una camioneta.

-- ── Intervalo propio por unidad ──────────────────────────────────────────────────────────────
-- NULL = usa el intervalo general de configuración. Mismo criterio que `capacidad_tanque_l`.
alter table public.unidad_config
  add column if not exists km_servicio integer;

comment on column public.unidad_config.km_servicio is
  'Cada cuántos km toca el cambio de aceite de ESTA unidad. NULL = usa el intervalo general (cfg.km, 5.000 por defecto).';

-- ── El km del último cambio de aceite lo mantiene la BASE ─────────────────────────────────────
-- `entregas`/`mantenimientos` son la fuente de verdad; `km_data.ult_srv` es un caché.
-- Ver [norma-contador-lo-mantiene-la-base-no-la-app].
create or replace function public.km_data_recontar_servicio(p_cams text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_cams is null or array_length(p_cams,1) is null then return; end if;

  update public.km_data k
     set ult_srv = x.km,
         ultsrv  = x.km          -- las dos, hasta que se retire la duplicada
    from (
      select distinct on (m.cam) m.cam, m.km
        from public.mantenimientos m
       where m.item_id = 'aceite_motor'
         and coalesce(m.km,0) > 0
         and m.cam = any(p_cams)
       order by m.cam, m.f desc nulls last, m.km desc
    ) x
   where k.cam = x.cam;

  -- Sin ningún cambio de aceite registrado vuelve a 0: es «no sé», y así la pantalla lo puede decir
  -- en vez de inventar un próximo servicio.
  update public.km_data k
     set ult_srv = 0, ultsrv = 0
   where k.cam = any(p_cams)
     and not exists (
       select 1 from public.mantenimientos m
        where m.cam = k.cam and m.item_id = 'aceite_motor' and coalesce(m.km,0) > 0
     );
end;
$$;

revoke all on function public.km_data_recontar_servicio(text[]) from public, anon;

create or replace function public.mantenimientos_tocar_km_data()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare cams text[] := '{}';
begin
  if TG_OP in ('INSERT','UPDATE') and nullif(NEW.cam,'') is not null then cams := cams || NEW.cam; end if;
  if TG_OP in ('UPDATE','DELETE') and nullif(OLD.cam,'') is not null then cams := cams || OLD.cam; end if;
  if array_length(cams,1) is not null then
    perform public.km_data_recontar_servicio(cams);
  end if;
  return null;
end;
$$;

drop trigger if exists mantenimientos_ciclo_servicio on public.mantenimientos;
create trigger mantenimientos_ciclo_servicio
after insert or update of cam, km, item_id, f or delete
on public.mantenimientos
for each row execute function public.mantenimientos_tocar_km_data();

-- ── Poner al día lo que ya está registrado ────────────────────────────────────────────────────
select public.km_data_recontar_servicio(array(select cam from public.km_data where cam is not null));

-- VERIFICACIÓN:
-- select cam, km, ult_srv, (km - ult_srv) as km_desde_el_aceite from km_data where ult_srv > 0;
--   Flotilla 2026-08-04: FC01 70.017 / 65.652 -> 4.365 km recorridos (faltan 635, NO 4.983).
