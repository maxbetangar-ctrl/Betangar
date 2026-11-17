-- ══════════════════════════════════════════════════════════════════════════════
-- LA CAUSA DE CADA DÍA SIN CERRAR — «el sistema no me dejó» se contesta con un dato
--
-- Máximo, 16/11/2026: «lo primero que van a decir cuando no cerraron un día es
-- que el sistema no los dejó».
--
-- ⛔ VIVE EN SU PROPIA FUNCIÓN Y `btg_informe_llenado` LA LLAMA EN UNA LÍNEA.
--    No se copió la lógica adentro del informe: la regla de la causa tiene que
--    existir en UN solo lugar, igual que la regla de la nota. Y así el informe
--    sigue siendo UN documento con UN período, en vez de dos RPC que la pantalla
--    tiene que cuadrar. [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ── LAS CUATRO CAUSAS, Y EN QUÉ ORDEN GANAN ───────────────────────────────────
--
--  1. `bloqueo del sistema`  — hay una fila en `chofer_bloqueos` de esa unidad y
--     ese día: el chofer tocó Guardar y no quedó nada. Es la ÚNICA que confirma
--     la excusa, y existe recién desde el 16/11/2026.
--  2. `la cola lo retuvo`    — el checklist llegó al servidor DESPUÉS del día
--     declarado (`created_at` > `fecha`): estuvo sin poder subir. Medido sobre
--     723 checklists: pasó 3 veces en dos meses.
--  3. `del chofer, probado`  — usó la app DESPUÉS de la salida ese mismo día y
--     desde el mismo teléfono, o recibió el aviso «le quedó sin cerrar» ESE día.
--     Cualquiera de las dos refuta «no me dejó»; las dos juntas lo cierran.
--  4. `no decidible`         — ninguna de las anteriores. Se dice, no se inventa.
--
-- ⛔ EL ORDEN NO ES CAPRICHO: gana la que CONFIRMA sobre la que REFUTA. Un chofer
--    puede haberse trabado a las 18:00 y cargar un viaje a las 19:00 — las dos
--    cosas son verdad, y la fila lo dice entero en `prueba`. Tapar el bloqueo
--    porque después usó la app sería escribir una acusación con la mitad del dato.
--    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
-- ⛔ EL AVISO SE CRUZA POR `ref`, NO POR TELÉFONO. `recordar_cierre_checklist`
--    escribe `ref = 'cierre:'||cam||':'||fecha`, que es determinista. Cruzarlo
--    por número obliga a que la ficha del empleado esté bien, y ya sabemos cómo
--    termina eso: un teléfono mal cargado se leería como «no se le avisó», o sea
--    a favor del chofer. [[norma-la-palabra-que-identifica-es-la-rara]]
--
-- ⚠️ `enviado` NO PRUEBA QUE LLEGÓ. La fila de `cola_mensajes` prueba que el
--    sistema lo intentó, no que el chofer lo leyó: el acuse de verdad es
--    `deliveredAt`, que no vive en esta base. Por eso la prueba dice «se le
--    avisó», nunca «lo leyó». [[norma-el-destino-de-un-mensaje-es-el-wid]]
--
-- ⚠️ Y EL TIPEO SE MIDE APARTE, porque no es una falla de llenado: el día está
--    cerrado, el dato está mal. ⛔ La hora de llegada anterior a la de salida es
--    LEGÍTIMA en el turno nocturno —cruza la medianoche—: medido, 7 de 9 noches.
--    Sin separar por turno, el informe habría inventado siete errores.
--    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
-- ══════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.btg_causa_dias_sin_cerrar(p_desde date, p_hasta date)
returns json language plpgsql stable security definer
set search_path to 'public', 'pg_temp' as $fn$
declare
  v_out json;
  -- Desde cuándo `chofer_bloqueos` puede decir algo. Antes de su primera fila el
  -- vacío NO es «no hubo bloqueos»: es «nadie lo estaba anotando».
  -- [[norma-falta-de-dato-no-es-un-dato]]
  v_bloq_desde date := (select min(fecha)::date from chofer_bloqueos
                         where fecha ~ '^\d{4}-\d{2}-\d{2}$');
begin
  -- ⛔ LA UNIDAD DE CUENTA ES LA DEL INFORME: chofer + fecha, igual que el `dia`
  --    de `btg_informe_llenado` (que agrupa por `conductor, fecha` y nada más).
  --    Agrupar también por unidad y por turno daba 32 donde el informe dice 31,
  --    y dos números distintos para «días sin cerrar» EN EL MISMO DOCUMENTO
  --    obligan a preguntar cuál es el verdadero. Las unidades y los turnos
  --    involucrados viajan como lista, que es lo que hace falta para actuar.
  --    [[norma-la-etiqueta-sobre-el-numero-equivocado-inventa-un-dato]]
  with dia as (
    select c.conductor nom, c.fecha::date f,
      array_agg(distinct c.cam) cams,
      string_agg(distinct coalesce(c.turno,'?'), '+') turno,
      max((coalesce(c.km_salida,0)>0 or coalesce(c.hora_salida,'')<>'')::int) sal,
      max((coalesce(c.km_entrada,0)>0 or coalesce(c.hora_entrada,'')<>'')::int) lle,
      max(c.created_at) ult_chk,
      max(c.hora_salida) hs, max(c.hora_entrada) he
    from checklist c
    -- ⚠️ `checklist.fecha` es TEXTO. El `::date` solo corre sobre filas bien
    --    escritas, y la comparación va texto contra texto: en ISO el orden
    --    alfabético ES el cronológico.
    where c.fecha ~ '^\d{4}-\d{2}-\d{2}$'
      and c.fecha between to_char(p_desde,'YYYY-MM-DD') and to_char(p_hasta,'YYYY-MM-DD')
      and c.llenado_por = 'chofer'
    group by 1,2
  ),
  abierto as (select * from dia where sal = 1 and lle = 0),
  juzgado as (
    select a.nom, a.f, a.cams, a.turno, a.ult_chk,
      exists (select 1 from chofer_bloqueos b
               where b.cam = any(a.cams) and b.fecha = to_char(a.f,'YYYY-MM-DD')) bloqueo,
      (select count(*) from chofer_bloqueos b
        where b.cam = any(a.cams) and b.fecha = to_char(a.f,'YYYY-MM-DD')) bloq_n,
      (select max(b.pantalla_dijo) from chofer_bloqueos b
        where b.cam = any(a.cams) and b.fecha = to_char(a.f,'YYYY-MM-DD')
          and coalesce(b.pantalla_dijo,'') <> '') bloq_dijo,
      (a.ult_chk at time zone 'America/Caracas')::date > a.f llego_tarde,
      greatest(
        coalesce((select max(v.created_at) from viajes_chofer v
                   where v.chofer = a.nom and v.fecha = to_char(a.f,'YYYY-MM-DD')), a.ult_chk),
        coalesce((select max(s.created_at) from surtidas s
                   where s.chofer = a.nom and s.fecha = a.f), a.ult_chk)
      ) > a.ult_chk uso_despues,
      greatest(
        coalesce((select max(v.created_at) from viajes_chofer v
                   where v.chofer = a.nom and v.fecha = to_char(a.f,'YYYY-MM-DD')), a.ult_chk),
        coalesce((select max(s.created_at) from surtidas s
                   where s.chofer = a.nom and s.fecha = a.f), a.ult_chk)
      ) ult_act,
      exists (select 1 from cola_mensajes m, unnest(a.cams) u(cam)
               where m.ref = 'cierre:' || u.cam || ':' || to_char(a.f,'YYYY-MM-DD')) le_aviso
    from abierto a
  ),
  conmotivo as (
    select j.*,
      case when j.bloqueo      then 'bloqueo del sistema'
           when j.llego_tarde  then 'la cola lo retuvo'
           when j.uso_despues
             or j.le_aviso     then 'del chofer, probado'
           else 'no decidible' end causa,
      -- ⛔ LA PRUEBA ES EL DATO QUE DECIDIÓ, no una frase: sin él la causa es una
      --    opinión y en la reunión no se sostiene. Misma regla que `motivo`.
      btrim(concat_ws(' · ',
        case when j.bloqueo then
          'toco Guardar ' || j.bloq_n || ' vez/veces sin que quedara nada; la pantalla decia: ' ||
          coalesce(j.bloq_dijo, 'NADA, se trabo mudo') end,
        case when j.llego_tarde then
          'el checklist llego al servidor el ' ||
          to_char(j.ult_chk at time zone 'America/Caracas', 'DD/MM a las HH24:MI') ||
          ', despues del dia que declara' end,
        case when j.uso_despues then
          'uso la app a las ' ||
          to_char(j.ult_act at time zone 'America/Caracas','HH24:MI') ||
          ', despues de la salida de las ' ||
          to_char(j.ult_chk at time zone 'America/Caracas','HH24:MI') ||
          ' y desde el mismo telefono' end,
        case when j.le_aviso then
          'se le aviso ese mismo dia por WhatsApp que le faltaba cerrar' end,
        case when not j.bloqueo and not j.llego_tarde and not j.uso_despues
              and not j.le_aviso then
          'no hay rastro posterior ni aviso: con lo que hay hoy no se puede decidir' end
      )) prueba
    from juzgado j
  ),
  -- El tipeo: el día ESTÁ cerrado y el dato está mal. No es lo mismo que no llenar.
  --
  -- ⛔ ESTE SE MIDE POR JORNADA (unidad + fecha + turno) Y NO POR CHOFER-DÍA, y
  --    por eso sale de `checklist` y no de `dia`. Las horas de dos unidades del
  --    mismo día, metidas en un `max()`, inventan un cruce que nadie tipeó: la
  --    salida de una con la llegada de la otra. Es un número con la etiqueta
  --    equivocada, que es la forma más barata de acusar a alguien sin razón.
  --    [[norma-la-etiqueta-sobre-el-numero-equivocado-inventa-un-dato]]
  tipeo as (
    select c.conductor nom, c.fecha::date f, c.cam, coalesce(c.turno,'?') turno,
      max(c.hora_salida) hs, max(c.hora_entrada) he
    from checklist c
    where c.fecha ~ '^\d{4}-\d{2}-\d{2}$'
      and c.fecha between to_char(p_desde,'YYYY-MM-DD') and to_char(p_hasta,'YYYY-MM-DD')
      and c.llenado_por = 'chofer'
      -- ⛔ EL NOCTURNO CRUZA LA MEDIANOCHE: ahi la llegada ANTERIOR a la salida es
      --    lo correcto, no un error. Medido: 7 de 9 noches.
      and coalesce(c.turno,'') <> 'nocturno'
    group by 1,2,3,4
    having max(c.hora_entrada) ~ '^\d{1,2}:\d{2}$'
       and max(c.hora_salida)  ~ '^\d{1,2}:\d{2}$'
       and max(c.hora_entrada) < max(c.hora_salida)
  )
  select json_build_object(
    'bloqueos_se_anotan_desde', v_bloq_desde,
    'resumen', json_build_object(
      'dias_sin_cerrar',      (select count(*) from conmotivo),
      'bloqueo_del_sistema',  (select count(*) from conmotivo where causa='bloqueo del sistema'),
      'la_cola_lo_retuvo',    (select count(*) from conmotivo where causa='la cola lo retuvo'),
      'del_chofer_probado',   (select count(*) from conmotivo where causa='del chofer, probado'),
      'no_decidible',         (select count(*) from conmotivo where causa='no decidible'),
      'jornadas_con_tipeo_malo', (select count(*) from tipeo),
      'dias_cerrados_medidos',(select count(*) from dia where lle=1)
    ),
    'por_persona', (
      select coalesce(json_agg(x order by x.sin_cerrar desc, x.chofer), '[]'::json) from (
        select nom chofer, count(*) sin_cerrar,
          count(*) filter (where causa='bloqueo del sistema') bloqueo_del_sistema,
          count(*) filter (where causa='la cola lo retuvo')   la_cola_lo_retuvo,
          count(*) filter (where causa='del chofer, probado') del_chofer_probado,
          count(*) filter (where causa='no decidible')        no_decidible,
          (select count(*) from tipeo t where t.nom = c.nom)  jornadas_con_tipeo_malo
        from conmotivo c group by 1
      ) x
    ),
    'dias', (
      select coalesce(json_agg(y order by y.fecha desc, y.unidad), '[]'::json) from (
        select f fecha,
          array_to_string(array(select replace(u,'JAC-','') from unnest(cams) u), ', ') unidad,
          nom chofer, turno, causa, prueba
        from conmotivo
      ) y
    ),
    'tipeo', (
      select coalesce(json_agg(z order by z.fecha desc), '[]'::json) from (
        select f fecha, replace(cam,'JAC-','') unidad, nom chofer, turno,
          'salio ' || hs || ' y declara llegada ' || he || ', que es ANTES' que_dice
        from tipeo
      ) z
    )
  ) into v_out;

  return v_out;
end $fn$;

comment on function public.btg_causa_dias_sin_cerrar(date, date) is
  'Por cada dia que un chofer abrio y no cerro, dice la CAUSA con la prueba que la decidio: bloqueo del sistema (hay fila en chofer_bloqueos), la cola lo retuvo (el checklist llego despues del dia declarado), del chofer probado (uso la app despues de la salida ese dia, o se le aviso ese dia), o no decidible. Aparte cuenta el TIPEO: dias cerrados con la hora de llegada anterior a la de salida, EXCLUYENDO el turno nocturno, que cruza la medianoche legitimamente. La regla de la causa vive aca y en ningun otro lado.';

revoke all on function public.btg_causa_dias_sin_cerrar(date, date) from public, anon;
grant execute on function public.btg_causa_dias_sin_cerrar(date, date) to authenticated;

commit;
