-- BETANGAR — Dónde se cargó el combustible, verificado solo
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Máximo dibujó por sus esquinas las dos estaciones donde se surte —E/S EL
-- PALOTAL y E/S LAS BANDERAS— y pidió dejar corriendo la verificación.
--
-- ⛔ LA PARTE DIFÍCIL NO ES MEDIR: ES SABER CUÁNDO EL NÚMERO ALCANZA PARA DECIR ALGO.
-- Hoy estuve por presentar «8 surtidas fuera de una estación» como hallazgo. Dos cosas
-- lo desarmaron, y las dos estaban disponibles antes de escribir la tabla:
--
--  1. Medía contra el CENTRO del polígono, no contra el BORDE. Seis de esas ocho
--     estaban a 4-9 metros del borde: camiones parados justo sobre la línea.
--  2. `surtidas.precision_gps` — el propio teléfono declara cuánto puede errar. Medido
--     sobre las 31 surtidas con ubicación: de 4 a 68 metros, media 23. Una carga a 70 m
--     con ±30 m de precisión no prueba absolutamente nada.
--
-- Y una tercera que aportó la realidad, no los datos: **un camión mide unos diez metros.**
-- El teléfono está en la cabina y la boca del tanque en otro lado. El chofer puede tener
-- la trompa adentro del terreno y el celular afuera. Exigirle al sistema una resolución
-- de seis metros sobre un objeto de diez es pedirle que invente.
--
-- LA TOLERANCIA, ENTONCES: `precision_gps + 12 m`. Lo que el aparato admite errar, más
-- el largo del vehículo. Una surtida se marca **solo** si la distancia al borde del
-- polígono supera eso.
-- ⛔ Sin precisión declarada se asume 30 m (la media redondeada hacia arriba), que es lo
-- conservador: entre marcar de más y marcar de menos, marcar de más produce alarmas
-- falsas y en dos semanas nadie mira la pantalla.
--
-- ⚠️ LA DISTANCIA ES APROXIMADA, Y ALCANZA. El operador `<->` de Postgres trabaja en
-- grados, donde un grado de longitud mide menos que uno de latitud. A la latitud de
-- Maracaibo (10,6°N) esa distorsión es del 1,7 % — un metro y medio sobre cien, contra
-- una tolerancia de decenas de metros. Usar PostGIS por esto sería precisión de adorno.
--
-- QUÉ NO PUEDE ESTA VISTA: las 41 surtidas de julio SIN ubicación. La captura del GPS
-- fue creciendo (6 % la semana del 20/07, 55 %, 88 %, y 100 % desde el 10/08), así que
-- las ciegas son casi todas viejas. Salen como 'sin ubicación' y NO como correctas: una
-- carga que no se puede verificar no es una carga verificada.
--
-- Reversa al final.

begin;

create or replace view public.v_estaciones_poligono as
select s.id, s.nombre,
       ('(' || string_agg('(' || (v->>1) || ',' || (v->>0) || ')', ',' order by o) || ')')::polygon poli
from public.sitios_asistencia s,
     lateral jsonb_array_elements(s.poligono) with ordinality t(v, o)
where s.activo = true
  and s.tipo = 'estacion'
  and s.poligono is not null
group by s.id, s.nombre;

comment on view public.v_estaciones_poligono is
  'Estaciones de servicio marcadas por sus esquinas. Solo con polígono: un círculo de '
  'más hace que una carga hecha en otro lado parezca hecha en la bomba, que es justo el '
  'control que esto viene a hacer.';

create or replace view public.v_surtidas_ubicacion as
with est as (select * from public.v_estaciones_poligono)
select
  su.id, su.fecha, su.hora, su.cam, su.chofer, su.litros, su.tanque,
  su.estacion_nombre                as dice_la_surtida,
  round(su.precision_gps::numeric, 0) as precision_m,
  cerca.nombre                      as estacion_mas_cerca,
  -- Distancia al BORDE del polígono, no al centro. Ver la cabecera: medir contra el
  -- centro fue lo que hizo parecer «lejos» a seis cargas que estaban sobre la línea.
  case when su.lat is null then null
       else round((point(su.lng, su.lat) <-> cerca.poli)::numeric * 110000, 0) end as m_al_borde,
  -- Lo que el instrumento admite errar, más el largo del camión.
  case when su.lat is null then null
       else round(coalesce(su.precision_gps, 30)::numeric, 0) + 12 end as tolerancia_m,
  case
    when su.lat is null then 'sin ubicación'
    when exists (select 1 from est where point(su.lng, su.lat) <@ est.poli) then 'en estación'
    when (point(su.lng, su.lat) <-> cerca.poli) * 110000
         <= coalesce(su.precision_gps, 30) + 12                          then 'dentro de la tolerancia'
    else 'FUERA de toda estación'
  end as veredicto
from public.surtidas su
left join lateral (
  select e.nombre, e.poli
    from est e
   where su.lat is not null
   order by point(su.lng, su.lat) <-> e.poli
   limit 1
) cerca on true;

comment on view public.v_surtidas_ubicacion is
  'Cada surtida contra las geocercas de estación. La tolerancia es `precision_gps + 12 m` '
  '(lo que el teléfono admite errar, más el largo del camión: el aparato va en la cabina y '
  'la boca del tanque en otro lado). ⛔ «sin ubicación» NO es «correcta»: es una carga que '
  'no se puede verificar. ⛔ Y si no hay ninguna estación con polígono, TODAS darían FUERA: '
  'antes de leer esta vista hay que comprobar que `v_estaciones_poligono` tenga filas.';

alter view public.v_estaciones_poligono set (security_invoker = on);
alter view public.v_surtidas_ubicacion  set (security_invoker = on);
revoke all on public.v_estaciones_poligono from anon;
revoke all on public.v_surtidas_ubicacion  from anon;
grant select on public.v_estaciones_poligono to authenticated;
grant select on public.v_surtidas_ubicacion  to authenticated;

commit;

-- ============================================================================
-- REVERSA:
--   drop view if exists public.v_surtidas_ubicacion;
--   drop view if exists public.v_estaciones_poligono;
-- ============================================================================
