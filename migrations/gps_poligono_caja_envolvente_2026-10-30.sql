-- BETANGAR — GPS: la caja envolvente ANTES del polígono, en `paso_por_poligono`
-- Fecha: 2026-10-30
--
-- ⛔ QUÉ PASABA. `paso_por_poligono` llamaba a `_tramo_toca_poligono` (o
--    `_punto_en_poligono`) **por cada posición del rango**. Esas funciones recorren TODAS
--    las esquinas del polígono en plpgsql: con una zona de 48 esquinas son 48 vueltas por
--    posición, y con un polígono de PARROQUIA de 168 a 384 esquinas son hasta 384.
--    Sobre un día (~7.000 posiciones) eso son 2,7 millones de iteraciones; sobre los 7 días
--    de un reclamo, 19 millones.
--
-- 📏 MEDIDO el 30/10/2026, ya con el filtro por día arreglado (esto es lo que QUEDABA):
--    · zona de 48 esquinas, 1 día:            24,5 s
--    · parroquia entera (384 esquinas), 3 d:  NO TERMINA — corta por tiempo de conexión
--    Y el 30/10 esas mismas pruebas, lanzadas en paralelo, **tumbaron la base compartida**
--    (Betangar + Geppetto + Ranita) más de 15 minutos.
--    ⇒ Hoy una denuncia de la Alcaldía sobre una zona grande NO se puede contestar.
--
-- ✅ QUÉ SE HACE. Se calcula **una sola vez** la caja envolvente del polígono (lat/lon
--    mínimo y máximo de sus esquinas) y se descarta por comparación de números cualquier
--    punto o tramo que caiga enteramente fuera de ella, ANTES de entrar al polígono.
--
-- ⛔ POR QUÉ ES EXACTO Y NO UNA APROXIMACIÓN. `_tramo_toca_poligono` es geometría
--    ESTRICTA, sin radio: devuelve true solo si una punta está adentro (`_punto_en_poligono`)
--    o si el tramo cruza un lado (`_cruzan`). La caja envolvente CONTIENE al polígono, así
--    que si la caja del tramo no se superpone con la caja del polígono:
--      · ninguna de sus dos puntas puede estar adentro del polígono, y
--      · no puede cruzar ningún lado, porque todos los lados están dentro de la caja.
--    El descarte es por lo tanto equivalente, no una heurística. ⚠️ Esto SOLO vale porque
--    no hay tolerancia: el día que alguien le ponga un radio de N metros a esta función,
--    la caja tiene que agrandarse en N (como hace `zona_cobertura_del_dia`, que compara
--    contra `zona_calles.la_min/la_max` con un margen de 0,0004° porque mide a 45 m).
--
-- Es la misma idea que ya usa el producto en `zona_calles` (columnas `la_min`, `la_max`,
-- `lo_min`, `lo_max`): descartar con cuatro comparaciones antes de hacer la cuenta caliente.
--
-- ⛔ LO QUE NO SE TOCA: el orden de las posiciones, la ventana `lag()` que arma los tramos,
--    ni el filtro de fechas. La caja se aplica DESPUÉS de la ventana, sobre el tramo ya
--    armado — si se filtrara antes, se perdería el punto anterior de un tramo que sí entra
--    a la zona, y el tramo quedaría mal medido o directamente invisible.
--
-- `dias_por_poligono` no se toca: delega en esta función, así que hereda la mejora.

begin;

CREATE OR REPLACE FUNCTION public.paso_por_poligono(p_poli jsonb, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_minutos_tramo integer DEFAULT 5)
 RETURNS TABLE(f date, cam text, hora timestamp with time zone, por text, min_del_tramo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_desde date := p_desde; v_hasta date := p_hasta; v_n int;
        v_la_min double precision; v_la_max double precision;
        v_lo_min double precision; v_lo_max double precision;
begin
  perform gps_ve_o_falla();
  v_n := jsonb_array_length(p_poli);
  if v_n is null or v_n < 3 then
    -- ⛔ Se dice. Un polígono de dos esquinas devolvería CERO días y eso se leería
    -- como «nunca pasamos», que es lo contrario de lo que hay que contestar.
    raise exception 'La zona necesita al menos 3 esquinas (llegaron %)', coalesce(v_n, 0);
  end if;

  -- La caja envolvente del polígono, UNA vez. Cada esquina es [lat, lon].
  select min((v->>0)::double precision), max((v->>0)::double precision),
         min((v->>1)::double precision), max((v->>1)::double precision)
    into v_la_min, v_la_max, v_lo_min, v_lo_max
    from jsonb_array_elements(p_poli) v;

  return query
  with par as (
    select p.cam cc, p.ts, p.lat, p.lon,
           lag(p.lat) over w la, lag(p.lon) over w lo, lag(p.ts) over w t0
      from gps_posiciones p
     where (v_desde is null or p.ts >= (v_desde::timestamp at time zone 'America/Caracas'))
       and (v_hasta is null or p.ts < ((v_hasta + 1)::timestamp at time zone 'America/Caracas'))
    window w as (partition by p.cam order by p.ts)
  ), medido as (
    select (ts at time zone 'America/Caracas')::date ff, cc, ts,
           extract(epoch from (ts - t0))/60.0 mins,
           -- ⚡ Primero la caja: cuatro comparaciones de números. Si el punto o el tramo
           -- cae ENTERO fuera de la caja del polígono, no puede tocarlo — y así no se
           -- entra a recorrer las esquinas. Es un descarte exacto, no una aproximación.
           case when least(coalesce(la, lat), lat)    > v_la_max
                  or greatest(coalesce(la, lat), lat) < v_la_min
                  or least(coalesce(lo, lon), lon)    > v_lo_max
                  or greatest(coalesce(lo, lon), lon) < v_lo_min then false
                when la is null then _punto_en_poligono(lat, lon, p_poli)
                else _tramo_toca_poligono(la, lo, lat, lon, p_poli) end toca,
           (la is not null) hay_tramo
      from par
  )
  select ff, cc, ts,
         case when not hay_tramo then 'punto'
              when mins <= p_minutos_tramo then 'tramo'
              else 'tramo largo (no cuenta)' end,
         round(mins::numeric, 1)
    from medido
   where toca
   order by ff desc, ts;
end $function$;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- 1. MISMO RESULTADO, no parecido. Duplicar la versión anterior con otro nombre y comparar
--    con `except all` en los dos sentidos, o por huella:
--      select md5(string_agg(t::text, '|' order by t::text)), count(*)
--        from paso_por_poligono(<poli>, '2026-10-28', '2026-10-28', 5) t;
--    ⚠️ Con el candado de rol puesto (`gps_ve_o_falla`): con el claim de un usuario con
--    rol, no como `postgres`, o se está probando otra cosa.
-- 2. Que la mejora exista: el mismo llamado, antes y después, con `\timing`.
-- 3. Que el polígono de PARROQUIA entera ahora termine. Era el caso que no cerraba.
-- ⛔ Y acotado: tope por consulta (`set local statement_timeout`), de a una. El 30/10 estas
--    mismas pruebas sin tope tumbaron la base compartida.
