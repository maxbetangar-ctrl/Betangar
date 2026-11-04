-- ════════════════════════════════════════════════════════════════════════════
--  UN ÍNDICE POR FECHA: `(cam, ts)` NO SIRVE CUANDO NO SE NOMBRA EL CAMIÓN.
--
--  LO QUE PASÓ (31/10/2026). El vigilante estrenó el control de las calles
--  vigiladas y lo primero que dijo fue «no se pudo comprobar». El error real:
--  **`statement timeout`**. `calles_fijas_del_dia` tardaba 6,6 s y PostgREST la
--  cortaba — devolvía vacío, que se lee igual que «está todo recorrido».
--
--  Midiendo por partes, el culpable no era la geometría: **contar las 6.467
--  posiciones de UN día tardaba 2,7 s**. `gps_posiciones` sólo tiene
--  `(cam, ts)` y `(id)`. Por la regla del prefijo izquierdo, un filtro que pide
--  un rango de `ts` SIN nombrar `cam` no puede usar ese índice: recorre las
--  329.649 filas enteras. Y filtrar por día sin camión es lo que hace casi todo
--  lo que mira la flota completa — la cobertura por zonas, el cuadre, el parte.
--
--  ⚠️ Esto NO contradice la reescritura sargable del 30/10: aquella arregló que
--     el filtro estuviera escrito como `(ts at time zone ...)::date = d`, con una
--     función encima de la columna, que apaga CUALQUIER índice. Ahora el filtro
--     está bien escrito y aun así no hay índice que lo atienda. Son dos cosas
--     distintas y hacían falta las dos. [[norma-medir-contra-produccion-es-una-operacion]]
--
--  POR QUÉ BRIN Y NO BTREE: medido, `ts` tiene correlación física **0,9887** —
--  las posiciones se insertan en orden de llegada, así que el orden del disco ya
--  es el orden del tiempo. Para ese caso BRIN pesa kilobytes en vez de los ~7 MB
--  de un btree y responde igual de bien en consultas por rango. Un btree sería
--  mejor para buscar UNA posición suelta por `ts`, cosa que nadie hace.
--
--  ⚠️ `CREATE INDEX` toma un lock que frena las ESCRITURAS mientras construye.
--     Acá son 330 mil filas y un BRIN se arma leyendo la tabla una vez: segundos.
--     El sondeo inserta cada minuto y espera sin perder nada. No se usa
--     CONCURRENTLY porque no puede correr dentro de una transacción.
-- ════════════════════════════════════════════════════════════════════════════

-- La medición ANTES, para que el número de después signifique algo.
do $antes$
declare v_ms numeric; v_t timestamptz := clock_timestamp();
begin
  perform count(*) from gps_posiciones
   where ts >= ((current_date - 1)::timestamp at time zone 'America/Caracas')
     and ts <  (current_date::timestamp at time zone 'America/Caracas');
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(seconds from (clock_timestamp() - v_t));
  raise notice 'ANTES · contar un dia: % ms', round(v_ms);
end $antes$;

create index if not exists gps_posiciones_ts_brin
  on gps_posiciones using brin (ts) with (pages_per_range = 32);

comment on index gps_posiciones_ts_brin is $c$Para las consultas que piden UN DÍA de toda la flota, sin nombrar camión: el índice `(cam, ts)` no las puede atender porque `cam` va primero. Sin esto, contar las posiciones de un día recorría las 330 mil filas (2,7 s) y `calles_fijas_del_dia` se pasaba del statement timeout de PostgREST, devolviendo vacío — que se lee igual que «no hay nada que avisar». Es BRIN porque `ts` tiene correlación física 0,99 (las posiciones se insertan en orden de llegada): pesa kilobytes contra los ~7 MB de un btree.$c$;

analyze gps_posiciones;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $v$
declare
  v_ms numeric; v_t timestamptz; v_plan text; v_n int;
begin
  -- 1 · El índice existe.
  if not exists (select 1 from pg_indexes
                  where tablename = 'gps_posiciones' and indexname = 'gps_posiciones_ts_brin') then
    raise exception 'el indice no quedo creado';
  end if;

  -- 2 · Y EL PLANIFICADOR LO USA. Que exista no prueba que sirva: un índice que
  --    el planificador descarta es peso muerto que además engaña al que lo lee.
  for v_plan in
    execute 'explain (format text) select count(*) from gps_posiciones
              where ts >= ((current_date - 1)::timestamp at time zone ''America/Caracas'')
                and ts <  (current_date::timestamp at time zone ''America/Caracas'')'
  loop
    if position('gps_posiciones_ts_brin' in v_plan) > 0 then
      raise notice 'OK · el plan usa el indice: %', trim(v_plan);
      v_n := 1;
    end if;
  end loop;
  if v_n is null then
    raise warning 'EL PLANIFICADOR NO USA EL INDICE: revisar antes de dar esto por bueno';
  end if;

  -- 3 · El tiempo después.
  v_t := clock_timestamp();
  perform count(*) from gps_posiciones
   where ts >= ((current_date - 1)::timestamp at time zone 'America/Caracas')
     and ts <  (current_date::timestamp at time zone 'America/Caracas');
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(seconds from (clock_timestamp() - v_t));
  raise notice 'DESPUES · contar un dia: % ms', round(v_ms);

  -- 4 · Y que la función que lo motivó entre en el tiempo de PostgREST.
  -- ⛔ CON EL CLAIM DE SERVICIO. `calles_fijas_del_dia` llama a `cronograma_del_dia`,
  --    que tiene candado de rol. Sin esto la comprobación se cae y ARRASTRA la
  --    migración entera: el primer intento no llegó a crear el índice por esto.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_t := clock_timestamp();
  perform count(*) from calles_fijas_del_dia(current_date);
  v_ms := extract(milliseconds from (clock_timestamp() - v_t))
        + 1000 * extract(seconds from (clock_timestamp() - v_t));
  raise notice 'calles_fijas_del_dia: % ms', round(v_ms);
  if v_ms > 3000 then
    raise warning 'sigue tardando % ms: PostgREST la puede volver a cortar', round(v_ms);
  end if;
end $v$;
