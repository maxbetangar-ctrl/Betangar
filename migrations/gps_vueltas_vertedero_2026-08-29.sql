-- BETANGAR — Las VUELTAS al vertedero se cuentan solas, y se cruzan con la planilla
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. `gps_dia.vueltas` existe desde el 14/08 y está en NULL los 16 días. La
-- migración que la creó lo dejó escrito: «`vueltas` NO se toca: la llena otra pieza
-- cuando exista la geocerca del botadero». Hoy Máximo dibujó los dos vertederos por sus
-- esquinas (VERTEDERO DE LA CONCEPCIÓN y RECIMARA), así que la geocerca existe.
--
-- POR QUÉ IMPORTA. Un viaje facturado a la Alcaldía es hoy la palabra del chofer escrita
-- en una planilla. Con esto pasa a ser un recorrido con hora de entrada y de salida del
-- vertedero. Eso sirve para las dos direcciones: para cobrar lo ejecutado —hay 1.784
-- viajes ejecutados y no facturados— y para que un viaje que no ocurrió no se facture.
--
-- MEDIDO ANTES DE PROGRAMARLO, sobre los 15 días de JAC-B010: de 13 días con planilla,
-- **11 coinciden exacto** entre las entradas al vertedero y los viajes declarados. Los
-- dos que no:
--   · 14/08 — GPS 2, planilla 3: el sondeo arrancó a las 14:26, faltó la mañana. El
--     método no falló; faltaban datos, y por eso el resultado dice cuántos puntos tuvo
--     el día.
--   · 23/08 — GPS 3, planilla 2: tres entradas a RECIMARA (16:52, 19:22, 21:09) contra
--     dos viajes declarados. Eso es una pregunta para quien lleva la operación, no una
--     acusación: era domingo y en horario nocturno.
--
-- CÓMO SE CUENTA UNA VUELTA, y por qué así:
--  · Una VISITA es un grupo de posiciones dentro de una geocerca de tipo `vertedero`.
--  · Dos visitas se separan si entre una posición adentro y la siguiente pasan más de
--    `v_corte` minutos. ⛔ Sin ese corte, el camión que sale y vuelve el mismo día
--    contaría una sola vez; con un corte muy chico, la deriva del GPS en el borde
--    partiría una descarga en dos y contaría de más — que es peor, porque infla lo que
--    se le cobra a la Alcaldía.
--  · Una visita cuenta como vuelta si duró `v_min_min` o más. Medido: las descargas
--    reales de B010 duran entre 9 y 18 minutos y traen entre 10 y 19 posiciones. Un
--    camión que solo pasa por el borde no llega a eso.
--
-- ⛔ ESTE NÚMERO ES UN PISO, NO UNA VERDAD. Si el equipo dejó de reportar mientras el
-- camión estaba adentro, la vuelta no se ve. Por eso NUNCA se usa solo: se lee junto a
-- `puntos` y `hueco_max_min` del mismo día. Un día con 600 puntos y 13 min de hueco se
-- puede discutir; uno con 300 puntos y una hora de hueco, no.
--
-- Reversa al final.

begin;

-- ── Las geocercas de descarga, en formato polígono de Postgres ───────────────
-- Se resuelve en una vista para no repetir el armado en cada consulta, y para que el
-- día que un vertedero se redibuje, todo lo que cuelga de acá lo tome solo.
create or replace view public.v_geocercas_vertedero as
select s.id, s.nombre,
       ('(' || string_agg('(' || (v->>1) || ',' || (v->>0) || ')', ',' order by o) || ')')::polygon poli
from public.sitios_asistencia s,
     lateral jsonb_array_elements(s.poligono) with ordinality t(v, o)
where s.activo = true
  and s.tipo = 'vertedero'
  and s.poligono is not null
group by s.id, s.nombre;

comment on view public.v_geocercas_vertedero is
  'Geocercas activas de descarga, listas para `point(lon,lat) <@ poli`. Solo las que '
  'tienen polígono: un círculo no se usa acá porque de un radio de más salen descargas '
  'que nunca ocurrieron.';

-- ── Contar las vueltas de un día ────────────────────────────────────────────
create or replace function public.gps_contar_vueltas(p_f date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- El día es el del NEGOCIO: hora de Venezuela.
  v_f       date    := coalesce(p_f, (now() at time zone 'America/Caracas')::date);
  v_corte   numeric := 20;    -- minutos fuera que separan dos visitas
  v_min_min numeric := 2;     -- lo que tiene que durar una visita para ser descarga
  v_n       integer := 0;
begin
  with p as (
    select g.cam, g.ts,
           exists (select 1 from v_geocercas_vertedero vc
                    where point(g.lon, g.lat) <@ vc.poli) as adentro
    from gps_posiciones g
    where (g.ts at time zone 'America/Caracas')::date = v_f
  ),
  dentro as (
    select cam, ts,
           lag(ts) over (partition by cam order by ts) as ts_ant
    from p where adentro
  ),
  marcada as (
    select cam, ts,
           -- Nueva visita cuando es la primera del día o cuando estuvo más de `v_corte`
           -- minutos sin aparecer adentro.
           case when ts_ant is null
                  or extract(epoch from (ts - ts_ant))/60 > v_corte
                then 1 else 0 end as nueva
    from dentro
  ),
  agrupada as (
    select cam, ts, sum(nueva) over (partition by cam order by ts) as visita
    from marcada
  ),
  visitas as (
    select cam, visita, min(ts) ini, max(ts) fin,
           extract(epoch from (max(ts) - min(ts)))/60 as minutos
    from agrupada group by cam, visita
  )
  update gps_dia d
     set vueltas = coalesce(v.n, 0)
    from (
      select cam, count(*)::int n from visitas
       where minutos >= v_min_min
       group by cam
    ) v
   where d.f = v_f and d.cam = v.cam;

  get diagnostics v_n = row_count;

  -- ⛔ Un día con posiciones y CERO visitas tiene que quedar en 0, no en NULL. NULL se
  -- lee como «no se midió» y 0 como «no fue»: son cosas distintas y la diferencia es
  -- justo lo que hay que poder ver al lado de la planilla.
  update gps_dia d
     set vueltas = 0
   where d.f = v_f and d.vueltas is null and coalesce(d.puntos,0) > 0;

  return v_n;
end
$fn$;

revoke all on function public.gps_contar_vueltas(date) from public, anon, authenticated;

-- ── El cruce contra la planilla ─────────────────────────────────────────────
create or replace view public.v_gps_vs_planilla as
select
  d.f                                   as fecha,
  d.cam,
  d.vueltas                             as vueltas_gps,
  pl.t                                  as viajes_planilla,
  (d.vueltas - pl.t)                    as diferencia,
  d.km_gps,
  pl.km                                 as km_planilla,
  pl.ch                                 as chofer_planilla,
  d.puntos,
  d.hueco_max_min,
  -- La confianza del día decide si la diferencia se puede discutir con alguien. Un día
  -- mal medido produce diferencias que NO son de la planilla: son del rastreo.
  -- ⛔ EL ORDEN DE ESTE CASE ES LA MITAD DEL DISEÑO. La confianza del día se evalúa
  -- DESPUÉS de comparar, no antes: si el GPS y la planilla coinciden, coinciden —
  -- que el día haya tenido un hueco largo no lo vuelve dudoso, al contrario, dos
  -- fuentes independientes dando el mismo número es la evidencia más fuerte que hay.
  -- La primera versión ponía la confianza arriba y marcaba «día mal medido» en cuatro
  -- días de trece que coincidían exacto: un aviso que salta cuando todo está bien
  -- enseña a ignorarlo, y para cuando salte de verdad ya nadie lo mira.
  case
    when pl.t is null                      then 'sin planilla'
    when d.vueltas is null                 then 'sin medir'
    when d.vueltas = pl.t                  then 'coincide'
    -- Hay diferencia. Recién acá importa si el día se puede discutir con alguien.
    when coalesce(d.puntos,0) < 200
      or coalesce(d.hueco_max_min,0) > 45  then 'diferencia NO concluyente'
    when d.vueltas > pl.t                  then 'GPS ve MÁS viajes'
    else                                        'GPS ve MENOS viajes'
  end                                   as estado
from gps_dia d
left join planillas pl
       on pl.cam = d.cam
      and pl.f   = to_char(d.f, 'YYYY-MM-DD');   -- `planillas.f` es text, no date

comment on view public.v_gps_vs_planilla is
  'Viajes declarados en la planilla contra entradas al vertedero medidas por GPS. ⛔ La '
  'columna `estado` no es un veredicto: «GPS ve MENOS viajes» en un día mal medido casi '
  'siempre es el rastreo, no la planilla. Por eso van al lado `puntos` y `hueco_max_min`.';

-- Las vistas no tienen RLS propio: `security_invoker` las hace respetar el de sus tablas.
alter view public.v_geocercas_vertedero set (security_invoker = on);
alter view public.v_gps_vs_planilla     set (security_invoker = on);

revoke all on public.v_geocercas_vertedero from anon;
revoke all on public.v_gps_vs_planilla     from anon;
grant select on public.v_geocercas_vertedero to authenticated;
grant select on public.v_gps_vs_planilla     to authenticated;

-- ── Que se calcule solo, junto con el resto del resumen del día ─────────────
create or replace function public.gps_tick_dia()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_hoy  date := (now() at time zone 'America/Caracas')::date;
  v_ayer date := v_hoy - 1;
  v_a int; v_b int;
begin
  -- Ayer se recalcula porque a las 00:15 el día recién cerró y pueden haber entrado
  -- posiciones tardías.
  perform public.gps_calcular_dia(v_ayer);
  perform public.gps_calcular_dia(v_hoy);
  v_a := public.gps_contar_vueltas(v_ayer);
  v_b := public.gps_contar_vueltas(v_hoy);
  return 'ok ' || v_ayer || '(' || v_a || ') ' || v_hoy || '(' || v_b || ')';
end
$fn$;

revoke all on function public.gps_tick_dia() from public, anon, authenticated;

commit;

-- Se cuentan los días que ya están guardados (16 días de JAC-B010).
select public.gps_contar_vueltas(f) from (select distinct f from gps_dia order by f) x;

-- ============================================================================
-- REVERSA:
--   update gps_dia set vueltas = null;
--   drop view if exists public.v_gps_vs_planilla;
--   drop view if exists public.v_geocercas_vertedero;
--   drop function if exists public.gps_contar_vueltas(date);
--   y recrear `gps_tick_dia` sin las dos llamadas a `gps_contar_vueltas`.
-- ============================================================================
