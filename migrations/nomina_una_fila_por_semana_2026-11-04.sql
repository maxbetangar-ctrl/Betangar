-- ════════════════════════════════════════════════════════════════════════════════════════
-- UNA SEMANA DE NÓMINA = UNA FILA.  2026-11-04
--
-- ⛔ POR QUÉ. En julio de 2026 `nomina_historial` tenía DOS filas para la misma semana con
--    totales distintos: `SEM-14` (01–07/06, 31 personas, $4.661,40) y `Semana 1` (01–06/06,
--    42 personas, $4.597,50). Hubo que decidir a mano cuál era la buena —se conservó
--    `Semana 1`, que queda a 1,5% de lo que pagó el banco contra el 8% de la otra— y borrar
--    la otra. La causa no fue el descuido: fue que **nada en la base impedía escribirlas las
--    dos**, porque la única llave era el `id`, y los dos esquemas de nombre («SEM-NN» del
--    Excel y «APP-mes-SemanaN» de la app) generaban ids distintos para la misma semana.
--    Mientras eso siga así, el mismo duplicado vuelve: infla el gasto acumulado y desvía la
--    Utilidad Real sin que nada avise.
--
--    El código de la app ya se arregló (hoy el id es `APP-<lunes>` y reutiliza la fila que
--    ya cubra ese lunes), y el importador nuevo de la RELACIÓN DE PAGO usa el MISMO esquema
--    a propósito. Pero eso es una barrera en el código, y una barrera en el código no es un
--    candado: cualquier script, cualquier carga a mano por REST o la próxima pieza que se
--    escriba puede volver a meter la segunda fila. El candado va en la base.
--    [[norma-arreglar-el-mecanismo-no-el-caso]] · [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ La llave NO puede ser `fecha_desde` pelada: las filas viejas tienen el arranque corrido
--    (una el lunes 01, otra el domingo 07 de la misma semana). La identidad de una semana de
--    nómina es SU LUNES, así que el índice va sobre el lunes calculado.
-- ════════════════════════════════════════════════════════════════════════════════════════

-- 1) CONTROL ANTES DE CREAR EL CANDADO: si ya hubiera dos filas para un mismo lunes, el
--    índice falla y hay que decidir cuál se queda. Esto lo DICE en vez de fallar mudo.
do $$
declare
  dup record;
  n int := 0;
begin
  for dup in
    select date_trunc('week', fecha_desde::timestamp)::date as lunes,
           count(*) as filas,
           string_agg(id || ' ($' || coalesce(total_usd,0) || ')', ' · ' order by id) as cuales
      from nomina_historial
     where fecha_desde is not null
     group by 1
    having count(*) > 1
  loop
    n := n + 1;
    raise warning 'SEMANA DUPLICADA · lunes % · % filas · %', dup.lunes, dup.filas, dup.cuales;
  end loop;
  if n > 0 then
    raise exception 'Hay % semana(s) con más de una fila. El candado NO se crea hasta que se '
                    'decida cuál fila se queda (la que case con lo que pagó el banco) y se '
                    'borre la otra, con respaldo. No se elige sola.', n;
  end if;
  raise notice 'control ok: ninguna semana tiene más de una fila';
end $$;

-- 2) EL CANDADO.
-- ⚠️ El cast a `::timestamp` NO es decorativo. `date_trunc('week', <date>)` resuelve a la
--    variante que depende de la ZONA HORARIA, que es STABLE y no IMMUTABLE, y Postgres rechaza
--    el índice con «functions in index expression must be marked IMMUTABLE». Con el cast a
--    timestamp sin zona sí es inmutable. Costó un intento.
create unique index if not exists nomina_historial_una_por_semana
    on nomina_historial ((date_trunc('week', fecha_desde::timestamp)::date))
 where fecha_desde is not null;

comment on index nomina_historial_una_por_semana is
  'Una semana de nómina = una fila. La identidad es el LUNES de fecha_desde, no el id ni la '
  'fecha exacta: los dos esquemas de id viejos («SEM-NN» del Excel y «APP-mes-SemanaN» de la '
  'app) metieron dos filas para la semana del 01/06/2026 con totales distintos. Si un insert '
  'choca con este índice, NO es un error del insert: es que esa semana ya está cerrada — hay '
  'que hacer upsert sobre la fila que existe, o decidir expresamente reemplazarla.';

-- 3) Las filas SIN `fecha_desde` quedan fuera del candado (el índice es parcial). Son las
--    viejas que se cargaron sin fechas; hoy no hay ninguna, pero si aparece una no se puede
--    ubicar en el calendario y por eso tampoco se puede proteger. Que se vea:
select count(*) as filas_sin_fecha_desde_que_el_candado_no_cubre
  from nomina_historial
 where fecha_desde is null;
