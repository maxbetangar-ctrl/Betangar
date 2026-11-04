-- BETANGAR — GPS: el atraso tiene DOS causas y hasta hoy una sola alarma, que medía mal
-- Fecha: 2026-10-30
--
-- ════════════════════════════════════════════════════════════════════════════════════
-- 1) `gps_reenvio_atraso()` MEDÍA LO QUE SU PROPIO MENSAJE NO DECÍA
-- ════════════════════════════════════════════════════════════════════════════════════
--
-- ⛔ EL SÍNTOMA, medido el 30/10/2026: de los 10 últimos mensajes del reenvío, **7 eran
--    avisos de atraso en falso**, todos de madrugada o de noche, todos de UN camión y UNA
--    posición: «1 posiciones sin mandar, la más vieja de hace 37 / 49 / 64 / 120 / 121 /
--    121 min» a las 02:20, 05:30, 06:40, 19:20, 21:20, 21:30 y 07:30.
--    **En los 7, el motor estaba APAGADO.** Y al momento de avisar, la última posición
--    tenía 1 a 6 minutos: el camión reportaba bien.
--
-- ⛔ LA CAUSA, y es de construcción, no de calibración. `atraso_min` era
--      now() - s.enviado_hasta
--    o sea **qué tan vieja es la última posición que YA MANDAMOS**. Con el motor apagado el
--    equipo reporta cada ~20 min y hasta 2 horas (medido el 30/10: mediana 19,8 min apagado
--    contra 1,00 min encendido). Entonces para un camión estacionado ese número **no puede
--    dar chico**: vale una ronda entera de reporte. Llega la posición nueva, `pendientes`
--    pasa a 1, y el reloj ya marca 120 min → salta el aviso, en la ventana de un minuto
--    entre que el dato entra y sale. Los «120 min» no eran nuestro atraso: eran el intervalo
--    de reporte del equipo apagado.
--    ⇒ Un camión apagado avisaba UNA VEZ POR RONDA DE REPORTE, para siempre.
--
-- ✅ EL ARREGLO ES LA PREGUNTA CORRECTA: «hace cuánto tenemos un dato EN LA MANO que
--    todavía no mandamos» = la edad de la posición pendiente más vieja. Sin pendientes no
--    hay atraso: no se puede estar atrasado con nada. Medido ahora mismo, los dos camiones
--    con pendientes dan **0,6 min** — tenemos el dato hace 36 segundos, perfectamente sano.
--
-- 🔎 Y LA PRUEBA MÁS LIMPIA: el texto del aviso ya decía «la más vieja de hace N min», que
--    es exactamente esta métrica. **El mensaje estaba bien escrito y la consulta medía otra
--    cosa.** Arreglando la consulta, el mensaje dice verdad sin tocarle una palabra.
--    [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
-- ⚠️ `atraso_min` queda NULL cuando no hay pendientes. El llamador ya filtra
--    `pendientes > 0` antes de comparar, así que no cambia nada para él — pero si alguna
--    pieza nueva lo usa, tiene que saberlo: NULL acá significa «no hay nada esperando»,
--    que es lo contrario de un problema. [[norma-falta-de-dato-no-es-un-dato]]
--
-- ════════════════════════════════════════════════════════════════════════════════════
-- 2) LA CAUSA QUE NO TENÍA ALARMA: que el PROVEEDOR nos entregue tarde
-- ════════════════════════════════════════════════════════════════════════════════════
--
-- Con el arreglo de arriba, la alarma del reenvío ya **no** avisa de un atraso del
-- proveedor — y está bien que no: si el proveedor no nos entrega, nosotros no estamos
-- atrasados, estamos esperando. Son dos fallas distintas y necesitan dos avisos distintos.
-- Pero la del proveedor no tenía ninguno, y pasa de verdad:
--   · 23/10: mediana de entrega **43,2 min**, p95 121, pico 170. 4.022 de 6.780 posiciones
--     (59% del día) con más de media hora de atraso. 23 ventanas seguidas, de 10:30 a 21:30.
--   · 27/10: 15 ventanas, peor mediana 60,2 min.  · 28/10: 9 ventanas, peor 119,1 min.
--   Nadie se enteró ninguna de las tres veces.
--
-- ⚠️ POR QUÉ IMPORTA: mientras el dato no llega, el mapa de la Alcaldía muestra al camión
--    quieto donde estuvo por última vez. No se pierde nada (el 23/10 cuadró: 6.780
--    posiciones y `gps_reenvio_cuadre` dice `cuadra` y `faltan 0` en las 10 unidades), pero
--    durante esas horas su pantalla dice algo que no es cierto — y eso es textualmente
--    «pensar que no estuve en un sitio que sí estuve».
--
-- 📏 EL UMBRAL SALE DE LA HISTORIA, NO DE MI CRITERIO. Se simuló la alarma en ventanas de
--    30 min sobre 12 días (358 ventanas):
--      · con **p95** y tope 15 min: 66 ventanas en **10 de 12 días** → el aviso que salta
--        siempre. Y peor: el p95 caza las posiciones REZAGADAS de una unidad que estuvo sin
--        cobertura y ya volvió — o sea grita por el sistema recuperándose, que es lo que
--        tiene que hacer. (El 25/10 12:30: p50 0,4 y p95 99,6. La ventana estaba bien.)
--      · con **la MEDIANA** y tope 20 min: 45 ventanas en **3 días** — justo el 23, el 27 y
--        el 28. Ventana típica: **0,33 min**, o sea el umbral queda 60× arriba de lo normal.
--    ⇒ La mediana, y 20 minutos. El estadístico era el problema, no el número.
--
-- ⛔ Y EL PISO ES NUESTRO: `creado - ts` mezcla al proveedor con nuestro sondeo. Hoy el cron
--    del sondeo es `* * * * *`, así que el piso es ~1 min. Si alguien lo espacia, este
--    número sube sin que el proveedor haya hecho nada. Por eso la función devuelve también
--    `sondeo_cada_min`: quien lea el aviso tiene que poder descartar la causa propia antes
--    de escribirle a un tercero. [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]

begin;

-- ── 1. La métrica correcta del atraso del reenvío ───────────────────────────
create or replace function gps_reenvio_atraso()
returns table (cam text, pendientes bigint, atraso_min numeric, ultimo_ok timestamptz, ultimo_error text)
language sql stable security definer set search_path = public as $$
  select s.cam,
         (select count(*) from gps_posiciones p where p.cam = s.cam and p.ts > s.enviado_hasta),
         -- La edad de la posición pendiente MÁS VIEJA: hace cuánto tenemos un dato en la
         -- mano sin mandar. NULL si no hay nada pendiente — y eso NO es un atraso de cero,
         -- es la ausencia de atraso. El llamador filtra `pendientes > 0` primero.
         round(extract(epoch from (now() - (
           select min(p.ts) from gps_posiciones p
            where p.cam = s.cam and p.ts > s.enviado_hasta))) / 60.0, 1),
         s.ultimo_ok, s.ultimo_error
    from gps_reenvio_estado s
    join gps_equipos e on e.cam = s.cam
   where e.activo and e.imei is not null
   order by 2 desc
$$;

comment on function gps_reenvio_atraso() is
  'Por unidad: cuántas posiciones esperan y hace cuánto tenemos la más vieja SIN MANDAR. '
  '⛔ NO es `now() - enviado_hasta`: eso medía la antigüedad de la última posición, que con '
  'el motor apagado vale una ronda de reporte (hasta 2 h) y hacía saltar el aviso una vez '
  'por ronda, para siempre — 7 avisos en falso medidos el 30/10/2026. '
  '⚠️ `atraso_min` es NULL cuando no hay pendientes: ausencia de atraso, no cero.';

-- ── 2. El atraso con que el PROVEEDOR nos entrega, ahora mismo ──────────────
-- ⛔ `p_hasta` existe para poder PROBARLA contra un caso malo conocido. Sin él la función
--    solo sabe mirar «ahora», y una alarma que no se puede apuntar al día en que tenía que
--    haber sonado es una alarma que nadie puede verificar. Apuntada al 23/10/2026 21:00 con
--    ventana de 30 min tiene que contestar `pasa_el_tope = true`; a hoy, false.
-- ⚠️ Y la ventana tiene que ser CORTA (30 min). Con una ventana de días la mediana se
--    diluye: sobre 8 días da 0,53 min aunque uno de esos días tuvo mediana de 43. El primer
--    control positivo que escribí falló justo por eso, y el error era del control, no de la
--    función. [[norma-una-medicion-tiene-hora]]
-- ⛔ Se BORRA la versión de un solo argumento antes de crear la de dos. `create or replace`
--    con otra firma NO reemplaza: crea una SEGUNDA función, y entonces
--    `gps_atraso_entrega(30)` seguiría cayendo en la vieja —la que no se puede apuntar a un
--    día— mientras el repo muestra la nueva. Dos versiones de lo mismo se desincronizan.
drop function if exists gps_atraso_entrega(integer);

create or replace function gps_atraso_entrega(
  p_ventana_min integer default 30,
  p_hasta timestamptz default null
)
returns table (
  posiciones bigint, p50_min numeric, p95_min numeric, peor_min numeric,
  tardias bigint, sondeo_cada_min integer, tope_min numeric, pasa_el_tope boolean
)
language sql stable security definer set search_path = public as $$
  with fin as (select coalesce(p_hasta, now()) t),
  v as (
    select extract(epoch from (creado - ts))/60.0 m
      from gps_posiciones, fin
     where creado >  fin.t - (p_ventana_min || ' minutes')::interval
       and creado <= fin.t
  ), t as (
    select coalesce((select valor from configuracion
                      where clave = 'gps_atraso_entrega_tope_min')::numeric, 20) tope
  ), s as (
    -- Cada cuánto corre NUESTRO sondeo: el piso del atraso es propio, no del proveedor.
    -- Se lee del cron, no de una constante: dos listas a mano se desincronizan.
    select case when schedule = '* * * * *' then 1
                when schedule ~ '^\*/[0-9]+ ' then
                  (regexp_match(schedule, '^\*/([0-9]+) '))[1]::int
                else null end m
      from cron.job where jobname = 'gps-sondeo-betangar'
  )
  select count(*),
         round(percentile_cont(0.5)  within group (order by v.m)::numeric, 2),
         round(percentile_cont(0.95) within group (order by v.m)::numeric, 2),
         round(max(v.m)::numeric, 1),
         count(*) filter (where v.m > 30),
         (select m from s),
         (select tope from t),
         -- ⛔ Con la MEDIANA, no con el p95: el p95 caza los rezagados de una unidad que
         --    volvió de un hueco de cobertura, o sea el sistema recuperándose.
         -- ⛔ Y con un mínimo de muestras: de madrugada entran 4 o 5 posiciones y una
         --    mediana sobre 5 muestras es ruido, no medición.
         coalesce(count(*) >= 20
           and percentile_cont(0.5) within group (order by v.m) > (select tope from t), false)
    from v
$$;

comment on function gps_atraso_entrega(integer, timestamptz) is
  'El atraso con que el PROVEEDOR nos entrega las posiciones en los últimos N minutos '
  '(`creado - ts`). ⛔ Es atraso, NO pérdida: lo que llega tarde llega, y el cuadre del '
  'reenvío del peor día (23/10/2026) da `cuadra` en las 10 unidades. Lo que se degrada es la '
  'vista EN VIVO, incluido el mapa de la Alcaldía. '
  '⚠️ `sondeo_cada_min` se devuelve a propósito: el piso del atraso es NUESTRO (el cron del '
  'sondeo), y hay que descartarlo antes de escribirle a un tercero. '
  'Umbral en `configuracion.gps_atraso_entrega_tope_min` (20 por omisión), sobre la MEDIANA '
  'y con al menos 20 muestras — calibrado sobre 358 ventanas de 12 días: con el p95 habría '
  'hablado en 10 de 12 días; con la mediana, en 3, que son los 3 incidentes reales.';

revoke all on function gps_atraso_entrega(integer, timestamptz) from anon;
grant execute on function gps_atraso_entrega(integer, timestamptz) to authenticated, service_role;

commit;

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- 1. La métrica arreglada, con los dos números al lado:
--      select cam, pendientes, atraso_min from gps_reenvio_atraso() order by 3 desc nulls last;
--    → un camión apagado y sin pendientes tiene que dar `atraso_min` NULL, no 120.
--    → con pendientes, el número tiene que ser de minutos, no de horas.
-- 2. select * from gps_atraso_entrega(30);
--    → en un día normal: p50 ≈ 0,3 · pasa_el_tope = false · sondeo_cada_min = 1.
-- 3. CONTROL POSITIVO — que sepa decir SÍ, no solo NO. ⛔ Y con ventana CORTA apuntada al
--    momento malo, NO con una ventana larga: sobre 8 días la mediana se diluye a 0,53 min
--    aunque el 23/10 tuvo 43. Así falló el primer control que escribí.
--      select * from gps_atraso_entrega(30, '2026-10-23 21:00 -04');  → pasa_el_tope = true
--      select * from gps_atraso_entrega(30, '2026-10-22 21:00 -04');  → false (día normal)
--    ⚠️ Si siempre contesta false, no está midiendo: está callada.
