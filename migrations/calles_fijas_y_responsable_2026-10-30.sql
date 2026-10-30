-- BETANGAR — CALLES FIJAS: cuadras que NO las reparte el algoritmo, y con dueño declarado
-- Fecha: 2026-10-30
--
-- ⛔ POR QUÉ. Máximo, 30/10/2026: «que no sea ambigua para que no hayan errores y nunca
--    deje de limpiarse y se sepa a qué camión se le exige esa calle (...) y la calle de
--    atrás que es como una T ciega debe hacerla el mismo camión».
--
-- ⛔ EL PROBLEMA ERA REAL Y MEDIDO. En el papel esa cuadra figuraba de DOS camiones
--    distintos del que la trabaja:
--      · el callejero da los tramos pegados al punto en la zona 4 (B003, a 4 m) y la
--        zona 8 (B005, a 8 m);
--      · pero el jueves 29/10 —último día de Olegario, que sale lunes y jueves— el que
--        estuvo ahí fue **B006: 94 posiciones, lo más cerca a 33 m**, mientras B001 no se
--        acercó de 201 m y B005 de 312 m.
--      · y `zona_en_punto` también la da en la zona 3, que es de B006.
--    ⇒ Dos fuentes independientes dicen B006 y el callejero dice otra cosa. Un reparto
--      automático la movía cada semana al que hubiera pasado.
--
-- ✅ LO QUE HACE ESTA PIEZA: permite CLAVAR tramos a un camión. Un tramo con `fijo_cam`
--    no lo toca ningún recálculo de zonas: se reparte todo lo demás alrededor.
--    ⚠️ Y el que recalcula TIENE que respetarlo. Si una pieza nueva reparte sin mirar
--    `fijo_cam`, el candado no sirve de nada y nadie se entera. Está dicho acá y en el
--    comentario de la columna, que es donde se lee.
--
-- ⛔ NO SE IDENTIFICA LA «T CIEGA» POR GEOMETRÍA, Y NO ES PEREZA. El callejero está
--    fragmentado: hay tramos de 59, 115 y 176 m con los DOS extremos sin conectar, así
--    que el detector de calle sin salida da falsos positivos y elegiría el fragmento
--    equivocado. Se fija por RADIO —todo lo que esté a menos de N metros del punto—, que
--    cubre la calle de la casa, la T de atrás y la esquina sin depender de acertar cuál
--    es cuál. Un criterio tosco que no se equivoca es mejor que uno fino que sí.
--
-- ⛔ Y LAS COORDENADAS NO VAN ACÁ: el repo es público. La función recibe el punto por
--    parámetro y el dato entra por script. [[norma-secreto-nunca-en-el-codigo]]

begin;

alter table public.zona_calles
  add column if not exists fijo_cam    text,
  add column if not exists fijo_motivo text,
  add column if not exists fijo_desde  timestamptz;

comment on column public.zona_calles.fijo_cam is
  '⛔ Si está lleno, este tramo tiene dueño DECLARADO y NINGÚN recálculo de zonas lo puede '
  'mover. Todo el que reparta zonas tiene que excluir las filas con `fijo_cam` no nulo; si '
  'no lo hace, el candado no avisa, simplemente deja de existir.';
comment on column public.zona_calles.fijo_motivo is
  'Por qué se clavó. Sin esto, en seis meses nadie sabe si se puede desclavar.';

-- El punto vigilado ahora dice a quién se le exige.
alter table public.puntos_vigilados
  add column if not exists cam_responsable text;
comment on column public.puntos_vigilados.cam_responsable is
  'A quién se le exige esta dirección. NULL = se acepta que pase cualquiera. Con dueño '
  'declarado el control distingue «pasó alguien» de «pasó el que tenía que pasar».';

-- ── Clavar los tramos de alrededor de un punto a un camión ──────────────────
drop function if exists public.zona_calles_fijar(text, text, double precision, double precision, integer, text);
create or replace function public.zona_calles_fijar(
  p_parroquia text, p_cam text, p_lat double precision, p_lon double precision,
  p_radio_m integer default 120, p_motivo text default null,
  -- ⛔ TOPE DE LARGO, y es imprescindible. Medido el 30/10: dentro de 120 m del primer
  --    punto hay un tramo de 2.704 m (Avenida 3F) y otro de 1.215 m. Sin este tope,
  --    fijar «la calle de la casa» le sacaba a otro camion una avenida entera de 2,7 km
  --    porque roza la esquina a 4 metros. Se fijan las calles del bloque, no las
  --    avenidas que pasan al lado.
  p_max_metros integer default 800
) returns table (fijados integer, metros_fijados integer, zona_destino smallint)
language plpgsql security definer set search_path = public as $$
declare v_zona smallint; v_n integer; v_m integer;
begin
  select a.zona into v_zona from zona_asignacion a
   where a.parroquia = p_parroquia and a.cam = p_cam
     and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date);
  if v_zona is null then
    -- ⛔ Se dice. Sin zona del camión, el update pondría `zona = null` y los tramos
    --    desaparecerían del mapa sin que nadie lo note.
    raise exception '% no tiene zona vigente en %', p_cam, p_parroquia;
  end if;

  with cerca as (
    select zc.id, zc.metros
      from zona_calles zc
     where zc.parroquia = p_parroquia
       -- la caja primero: cuatro comparaciones antes de la cuenta de distancia
       and zc.la_max >= p_lat - 0.0025 and zc.la_min <= p_lat + 0.0025
       and zc.lo_max >= p_lon - 0.0025 and zc.lo_min <= p_lon + 0.0025
       and zc.metros <= p_max_metros
       and _dist_a_tramo_m(p_lat, p_lon,
             (zc.geom->0->>0)::float8,  (zc.geom->0->>1)::float8,
             (zc.geom->-1->>0)::float8, (zc.geom->-1->>1)::float8) <= p_radio_m
  ), tocado as (
    update zona_calles zc
       set zona = v_zona, fijo_cam = p_cam, fijo_desde = now(),
           fijo_motivo = coalesce(p_motivo, 'fijado a mano')
      from cerca c where zc.id = c.id
    returning zc.metros
  )
  select count(*)::int, coalesce(sum(metros), 0)::int into v_n, v_m from tocado;

  return query select v_n, v_m, v_zona;
end $$;

comment on function public.zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) is
  'Clava a un camión todos los tramos a menos de N metros de un punto, y los marca para que '
  'ningún recálculo los mueva. Devuelve cuántos tramos y cuántos metros tocó. '
  '⛔ Revienta si el camión no tiene zona vigente en esa parroquia: sin eso el update '
  'dejaría los tramos con `zona = null`, o sea fuera del mapa y sin que nadie se enterara.';

revoke all on function public.zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) from anon, authenticated;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select fijo_cam, count(*) tramos, round(sum(metros)) metros, min(fijo_motivo) motivo
--   from zona_calles where fijo_cam is not null group by 1;
-- ⛔ Y LO QUE DE VERDAD HAY QUE PROBAR: que un recálculo NO los mueva. Correr el reparto
--    y volver a mirar: los tramos con `fijo_cam` tienen que seguir en la misma zona.
--    Un candado que nadie ejercitó es una intención, no un candado.
