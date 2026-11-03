-- ════════════════════════════════════════════════════════════════════════════
--  FIJAR UNA CALLE SE MIDE CONTRA LA CALLE, NO CONTRA SU CUERDA.
--
--  LO QUE PASÓ (2/11/2026). Al rehacer el reparto por manzana hubo que volver a
--  fijar las calles vigiladas —la dirección prioritaria del contrato— y la función
--  eligió MAL: dejó afuera el tramo que pasa a **6 metros** del punto y fijó uno
--  que está a 48 m.
--
--  ⛔ LA CAUSA: medía la distancia contra la CUERDA del tramo, de su primer vértice
--     al último, como si la calle fuera recta. Con el reparto viejo eso casi no se
--     notaba porque las avenidas se cortaban por carga y los tramos eran cortos.
--     Con el reparto nuevo la calle se corta DONDE CAMBIA LA ZONA, así que esa
--     quedó en un solo tramo de 861 m: su cuerda pasa lejos del punto aunque la
--     calle pase por la puerta.
--     Y de paso el tope `p_max_metros` (800 por omisión) la descartaba por larga.
--
--  ⚠️ ESTO NO CONTRADICE LO DECIDIDO ESA MISMA MAÑANA. En `zona_cobertura_del_dia`
--     se midió que pasar de la cuerda a los segmentos cambia UN tramo de 694, y se
--     dejó la cuerda por barata. Ahí se promedian cientos de tramos; acá se elige
--     UNO y se elige mal. La misma aproximación puede ser aceptable en un agregado
--     e inaceptable en una decisión puntual.
--     [[norma-medir-contra-produccion-es-una-operacion]]
--
--  ⛔ Y NO AVISABA. Contestó «1 tramo fijado, 177 m» y eso se lee como éxito. Lo
--     destapó comparar contra lo que había antes (4 tramos, 984 m). Por eso ahora
--     devuelve también a qué distancia quedó el tramo MÁS CERCANO que NO se fijó:
--     si hay uno más cerca que los fijados, algo se eligió mal.
--     [[norma-una-asercion-mal-escrita-acusa-al-producto]]
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists zona_calles_fijar(text, text, double precision, double precision, integer, text, integer);

create function zona_calles_fijar(
  p_parroquia text, p_cam text, p_lat double precision, p_lon double precision,
  p_radio_m integer, p_motivo text, p_max_metros integer default 1500)
returns table (fijados int, metros_fijados int, zona_destino smallint,
               mas_cerca_sin_fijar int)
language plpgsql security definer set search_path = public as $fn$
declare v_zona smallint; v_n int; v_m int; v_cerca int;
begin
  select a.zona into v_zona from zona_asignacion a
   where a.parroquia = p_parroquia and a.cam = p_cam
     and a.desde <= current_date and (a.hasta is null or a.hasta >= current_date);
  if v_zona is null then
    raise exception '% no tiene zona vigente en %', p_cam, p_parroquia;
  end if;

  with candidatos as (
    select zc.id, zc.metros,
           -- ⛔ CONTRA CADA SEGMENTO. Una calle de 861 m tiene dos vértices extremos
           --    y veinte curvas en el medio: su cuerda no es la calle.
           (select min(_dist_a_tramo_m(p_lat, p_lon,
                     (zc.geom->(i-1)->>0)::float8, (zc.geom->(i-1)->>1)::float8,
                     (zc.geom->i->>0)::float8,     (zc.geom->i->>1)::float8))
              from generate_series(1, jsonb_array_length(zc.geom) - 1) i) d
      from zona_calles zc
     where zc.parroquia = p_parroquia
       -- la caja primero: cuatro comparaciones antes de la cuenta de distancia
       and zc.la_max >= p_lat - 0.0025 and zc.la_min <= p_lat + 0.0025
       and zc.lo_max >= p_lon - 0.0025 and zc.lo_min <= p_lon + 0.0025
  ), cerca as (
    select id, metros from candidatos
     where d <= p_radio_m and metros <= p_max_metros
  ), tocado as (
    update zona_calles zc
       set zona = v_zona, fijo_cam = p_cam, fijo_desde = now(),
           fijo_motivo = coalesce(p_motivo, 'fijado a mano')
      from cerca c where zc.id = c.id
    returning zc.metros
  )
  select count(*)::int, coalesce(sum(metros), 0)::int into v_n, v_m from tocado;

  -- El más cercano que quedó AFUERA, para poder ver si se eligió mal.
  select round(min(d))::int into v_cerca from (
    select (select min(_dist_a_tramo_m(p_lat, p_lon,
                   (zc.geom->(i-1)->>0)::float8, (zc.geom->(i-1)->>1)::float8,
                   (zc.geom->i->>0)::float8,     (zc.geom->i->>1)::float8))
              from generate_series(1, jsonb_array_length(zc.geom) - 1) i) d
      from zona_calles zc
     where zc.parroquia = p_parroquia and zc.fijo_cam is null
       and zc.la_max >= p_lat - 0.0025 and zc.la_min <= p_lat + 0.0025
       and zc.lo_max >= p_lon - 0.0025 and zc.lo_min <= p_lon + 0.0025) q;

  return query select v_n, v_m, v_zona, v_cerca;
end $fn$;

comment on function zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) is $c$Fija los tramos cercanos a un punto al camión que debe hacerlos. ⛔ Mide contra CADA SEGMENTO del tramo, no contra su cuerda: el 2/11/2026 la versión por cuerda dejó afuera la calle que pasa a 6 m del punto —un tramo de 861 m con curvas— y fijó una a 48 m. ⛔ Devuelve `mas_cerca_sin_fijar`: si hay un tramo más cerca que los fijados, se eligió mal y hay que mirarlo. «1 tramo fijado» se lee como éxito y no lo es.$c$;

revoke all on function zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) from anon, public;
grant execute on function zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) to authenticated;
grant execute on function zona_calles_fijar(text, text, double precision, double precision, integer, text, integer) to service_role;
