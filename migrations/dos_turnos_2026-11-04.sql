-- ════════════════════════════════════════════════════════════════════════════════════════
-- DOS TURNOS AL DÍA.  2026-11-04
--
-- ⛔ POR QUÉ. La operatividad de Betangar cambió (declarado por Máximo el 04/11/2026): además
--    de la jornada diurna hay ahora un turno NOCTURNO, y en él los choferes CAMBIAN DE UNIDAD
--    —y con ellos los ayudantes—. Cada turno tiene que hacer su propio control: su checklist
--    de salida y de llegada, sus viajes, su cuadrilla.
--
--    Hoy eso es IMPOSIBLE, y no por la pantalla: por la base. `checklist` es UNIQUE
--    (fecha, cam) — UNA fila por unidad por día — así que el segundo turno no tiene dónde
--    escribir: pisaría el checklist del primero. Igual `viajes_chofer` (fecha, cam, viaje_num),
--    donde el nocturno chocaría al numerar, y `cuadrilla_dia` (fecha, cam, empleado_id), donde
--    la cuadrilla de la noche se mezclaría con la del día sin poder distinguirlas.
--
-- ⚠️ ESTA MIGRACIÓN NO CAMBIA EL COMPORTAMIENTO DE HOY. Todo lo existente queda como
--    'diurno' y las funciones, llamadas como hasta ahora, hacen exactamente lo mismo. Lo
--    único que cambia es que el turno nocturno PASA A SER POSIBLE.
--
-- ⚠️ NO CONFUNDIR con la «JORNADA ESPECIAL» que ya existe: ésa es una marca de TEXTO en la
--    parroquia/ruta de la planilla, para los corredores nocturnos. Es otra cosa y se queda
--    como está.
-- ════════════════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) La columna, en las tres tablas del día ──
-- Va NOT NULL con default: una fila sin turno no se podría ubicar en ningún lado, y un turno
-- escrito a mano con un typo sería un tercer turno fantasma — por eso el CHECK.
alter table public.checklist      add column if not exists turno text not null default 'diurno';
alter table public.viajes_chofer  add column if not exists turno text not null default 'diurno';
alter table public.cuadrilla_dia  add column if not exists turno text not null default 'diurno';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='checklist_turno_valido') then
    alter table public.checklist add constraint checklist_turno_valido
      check (turno in ('diurno','nocturno'));
  end if;
  if not exists (select 1 from pg_constraint where conname='viajes_chofer_turno_valido') then
    alter table public.viajes_chofer add constraint viajes_chofer_turno_valido
      check (turno in ('diurno','nocturno'));
  end if;
  if not exists (select 1 from pg_constraint where conname='cuadrilla_dia_turno_valido') then
    alter table public.cuadrilla_dia add constraint cuadrilla_dia_turno_valido
      check (turno in ('diurno','nocturno'));
  end if;
end $$;

-- ── 2) Las llaves. El turno entra en la identidad de la fila ──
alter table public.checklist      drop constraint if exists checklist_fecha_cam_key;
alter table public.viajes_chofer  drop constraint if exists viajes_chofer_fecha_cam_viaje_num_key;
alter table public.cuadrilla_dia  drop constraint if exists cuadrilla_dia_fecha_cam_empleado_id_key;

create unique index if not exists checklist_fecha_cam_turno_key
  on public.checklist (fecha, cam, turno);
create unique index if not exists viajes_chofer_fecha_cam_turno_viaje_key
  on public.viajes_chofer (fecha, cam, turno, viaje_num);
create unique index if not exists cuadrilla_dia_fecha_cam_turno_emp_key
  on public.cuadrilla_dia (fecha, cam, turno, empleado_id);

comment on column public.checklist.turno is
  'diurno | nocturno. Desde el 04/11/2026 cada unidad hace DOS jornadas al día, con chofer y '
  'ayudantes distintos, y cada una lleva su propio checklist de salida y llegada. Las filas '
  'anteriores a esa fecha son todas diurnas.';

-- ── 3) Las funciones que el teléfono del chofer llama ──
-- `p_turno` lleva valor por defecto a propósito: las llamadas de hoy, con dos argumentos,
-- siguen funcionando igual.
--
-- ⛔ PERO HAY QUE BORRAR LA DE DOS ARGUMENTOS PRIMERO. `create or replace` con un parámetro
--    de más NO reemplaza: crea una SEGUNDA función, y entonces la llamada de dos argumentos
--    calza con las dos y Postgres la rechaza por ambigua («function is not unique»). El
--    teléfono del chofer dejaría de leer su checklist.
--
-- ⛔ Y AL BORRARLA SE PIERDEN LOS PERMISOS. Toda función nace abierta a PUBLIC y los GRANT
--    no sobreviven al DROP: si se recrea sin volver a otorgar, `anon` no puede llamarla y
--    desde el teléfono se lee como «no guarda». Se vuelven a dar EXACTAMENTE los que tenía
--    —anon, authenticated y service_role, SIN public— medidos antes de tocar nada.
--    [[norma-toda-funcion-nace-abierta-a-public]] · [[norma-un-candado-que-rompe-la-herramienta-es-peor]]
drop function if exists public.chofer_checklist_dia(text, text);
drop function if exists public.chofer_viajes_dia(text, text);

create or replace function public.chofer_checklist_dia(p_cam text, p_fecha text, p_turno text default 'diurno')
 returns setof public.checklist
 language sql
 stable security definer
 set search_path to 'public'
as $fn$
  select * from public.checklist
   where cam = p_cam and fecha = p_fecha
     and turno = coalesce(nullif(p_turno,''),'diurno')
     and public.chofer_puede_ver(p_cam)
   limit 1
$fn$;

-- Sin turno devuelve los viajes de TODO el día, que es lo que hacía antes.
create or replace function public.chofer_viajes_dia(p_cam text, p_fecha text, p_turno text default null)
 returns setof public.viajes_chofer
 language sql
 stable security definer
 set search_path to 'public'
as $fn$
  select * from public.viajes_chofer
   where cam = p_cam and fecha = p_fecha
     and (p_turno is null or p_turno = '' or turno = p_turno)
     and public.chofer_puede_ver(p_cam)
$fn$;

create or replace function public.chofer_viaje_guardar(p jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $fn$
declare
  v_turno text := coalesce(nullif(p->>'turno',''),'diurno');
begin
  if coalesce(p->>'cam','') = '' or coalesce(p->>'fecha','') = '' or (p->>'viaje_num') is null then
    raise exception 'cam, fecha y viaje_num son obligatorios';
  end if;
  if not public.chofer_puede_ver(p->>'cam') then
    raise exception 'esa unidad no es la suya';
  end if;
  insert into public.viajes_chofer (fecha, cam, turno, chofer, viaje_num, hora, sincronizado)
  values (p->>'fecha', p->>'cam', v_turno, p->>'chofer', (p->>'viaje_num')::int, p->>'hora', true)
  on conflict (fecha, cam, turno, viaje_num) do update set
    chofer = case when p ? 'chofer' then excluded.chofer else public.viajes_chofer.chofer end,
    hora   = case when p ? 'hora'   then excluded.hora   else public.viajes_chofer.hora   end,
    sincronizado = true;
end $fn$;

-- Los permisos que tenían las dos recreadas, tal cual estaban antes del DROP.
revoke all on function public.chofer_checklist_dia(text, text, text) from public;
revoke all on function public.chofer_viajes_dia(text, text, text)    from public;
grant execute on function public.chofer_checklist_dia(text, text, text) to anon, authenticated, service_role;
grant execute on function public.chofer_viajes_dia(text, text, text)    to anon, authenticated, service_role;

-- La grande va PARCHEADA sobre su definición real, no reescrita.
CREATE OR REPLACE FUNCTION public.chofer_checklist_guardar(p jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cam   text := p->>'cam';
  v_fecha text := p->>'fecha';
  -- El turno llega del telefono; si no viene, es el de siempre.
  v_turno text := coalesce(nullif(p->>'turno',''),'diurno');
  v_quien text;
  v_id    text;
  r       public.checklist;
begin
  if coalesce(v_cam,'') = '' or coalesce(v_fecha,'') = '' then
    raise exception 'cam y fecha son obligatorios';
  end if;
  if not public.chofer_puede_ver(v_cam) then
    raise exception 'esa unidad no es la suya';
  end if;

  select llenado_por into v_quien
    from public.checklist where cam = v_cam and fecha = v_fecha and turno = v_turno;

  -- ⛔ El mecánico manda: si ya lo llenó él, esto no escribe NADA.
  if v_quien = 'mecanico' then
    return null;
  end if;

  r := jsonb_populate_record(null::public.checklist, p);

  insert into public.checklist (
    fecha,
    cam,
    turno,
    conductor,
    km_salida,
    km_entrada,
    hora_salida,
    hora_entrada,
    comb_salida,
    comb_entrada,
    luz_delantera_alta,
    luz_delantera_baja,
    luces_emergencia,
    luces_neblineros,
    luz_direccional,
    luz_freno_posterior,
    parabrisas_del,
    parabrisas_pos,
    limpia_parabrisas,
    vidrio_parabrisas,
    espejos_laterales,
    tablero_indicadores,
    freno_mano,
    freno_servicio,
    aceite_refrigerante,
    espejo_retrovisor,
    tapa_combustible,
    gato_hidraulico,
    herramientas,
    conos_seguridad,
    extintor,
    alarma_retroceso,
    cinturones,
    cunas_seguridad,
    lavado_tolva,
    corte_corriente,
    aceite_motor,
    refrigerante,
    liquido_hidraulico,
    trampa_agua,
    fugas,
    presion_aire,
    tuercas_esparragos,
    drenaje_tanques,
    llanta_repuesto,
    mangueras_hidraulicas,
    puntos_engrase,
    botones_parada,
    toma_fuerza,
    danio_frontal,
    danio_lateral_izq,
    danio_lateral_der,
    danio_posterior,
    danio_techo,
    observaciones,
    chofer_km_salida,
    chofer_km_entrada,
    chofer_comb_salida,
    chofer_comb_entrada,
    chofer_observaciones,
    chofer_fecha_llenado,
    estado_vehiculo,
    llenado_por
  ) values (
    r.fecha,
    r.cam,
    v_turno,
    r.conductor,
    r.km_salida,
    r.km_entrada,
    r.hora_salida,
    r.hora_entrada,
    r.comb_salida,
    r.comb_entrada,
    r.luz_delantera_alta,
    r.luz_delantera_baja,
    r.luces_emergencia,
    r.luces_neblineros,
    r.luz_direccional,
    r.luz_freno_posterior,
    r.parabrisas_del,
    r.parabrisas_pos,
    r.limpia_parabrisas,
    r.vidrio_parabrisas,
    r.espejos_laterales,
    r.tablero_indicadores,
    r.freno_mano,
    r.freno_servicio,
    r.aceite_refrigerante,
    r.espejo_retrovisor,
    r.tapa_combustible,
    r.gato_hidraulico,
    r.herramientas,
    r.conos_seguridad,
    r.extintor,
    r.alarma_retroceso,
    r.cinturones,
    r.cunas_seguridad,
    r.lavado_tolva,
    r.corte_corriente,
    r.aceite_motor,
    r.refrigerante,
    r.liquido_hidraulico,
    r.trampa_agua,
    r.fugas,
    r.presion_aire,
    r.tuercas_esparragos,
    r.drenaje_tanques,
    r.llanta_repuesto,
    r.mangueras_hidraulicas,
    r.puntos_engrase,
    r.botones_parada,
    r.toma_fuerza,
    r.danio_frontal,
    r.danio_lateral_izq,
    r.danio_lateral_der,
    r.danio_posterior,
    r.danio_techo,
    r.observaciones,
    r.chofer_km_salida,
    r.chofer_km_entrada,
    r.chofer_comb_salida,
    r.chofer_comb_entrada,
    r.chofer_observaciones,
    r.chofer_fecha_llenado,
    r.estado_vehiculo,
    'chofer'
  )
  on conflict (fecha, cam, turno) do update set
    conductor = case when p ? 'conductor' then excluded.conductor else public.checklist.conductor end,
    km_salida = case when p ? 'km_salida' then excluded.km_salida else public.checklist.km_salida end,
    km_entrada = case when p ? 'km_entrada' then excluded.km_entrada else public.checklist.km_entrada end,
    hora_salida = case when p ? 'hora_salida' then excluded.hora_salida else public.checklist.hora_salida end,
    hora_entrada = case when p ? 'hora_entrada' then excluded.hora_entrada else public.checklist.hora_entrada end,
    comb_salida = case when p ? 'comb_salida' then excluded.comb_salida else public.checklist.comb_salida end,
    comb_entrada = case when p ? 'comb_entrada' then excluded.comb_entrada else public.checklist.comb_entrada end,
    luz_delantera_alta = case when p ? 'luz_delantera_alta' then excluded.luz_delantera_alta else public.checklist.luz_delantera_alta end,
    luz_delantera_baja = case when p ? 'luz_delantera_baja' then excluded.luz_delantera_baja else public.checklist.luz_delantera_baja end,
    luces_emergencia = case when p ? 'luces_emergencia' then excluded.luces_emergencia else public.checklist.luces_emergencia end,
    luces_neblineros = case when p ? 'luces_neblineros' then excluded.luces_neblineros else public.checklist.luces_neblineros end,
    luz_direccional = case when p ? 'luz_direccional' then excluded.luz_direccional else public.checklist.luz_direccional end,
    luz_freno_posterior = case when p ? 'luz_freno_posterior' then excluded.luz_freno_posterior else public.checklist.luz_freno_posterior end,
    parabrisas_del = case when p ? 'parabrisas_del' then excluded.parabrisas_del else public.checklist.parabrisas_del end,
    parabrisas_pos = case when p ? 'parabrisas_pos' then excluded.parabrisas_pos else public.checklist.parabrisas_pos end,
    limpia_parabrisas = case when p ? 'limpia_parabrisas' then excluded.limpia_parabrisas else public.checklist.limpia_parabrisas end,
    vidrio_parabrisas = case when p ? 'vidrio_parabrisas' then excluded.vidrio_parabrisas else public.checklist.vidrio_parabrisas end,
    espejos_laterales = case when p ? 'espejos_laterales' then excluded.espejos_laterales else public.checklist.espejos_laterales end,
    tablero_indicadores = case when p ? 'tablero_indicadores' then excluded.tablero_indicadores else public.checklist.tablero_indicadores end,
    freno_mano = case when p ? 'freno_mano' then excluded.freno_mano else public.checklist.freno_mano end,
    freno_servicio = case when p ? 'freno_servicio' then excluded.freno_servicio else public.checklist.freno_servicio end,
    aceite_refrigerante = case when p ? 'aceite_refrigerante' then excluded.aceite_refrigerante else public.checklist.aceite_refrigerante end,
    espejo_retrovisor = case when p ? 'espejo_retrovisor' then excluded.espejo_retrovisor else public.checklist.espejo_retrovisor end,
    tapa_combustible = case when p ? 'tapa_combustible' then excluded.tapa_combustible else public.checklist.tapa_combustible end,
    gato_hidraulico = case when p ? 'gato_hidraulico' then excluded.gato_hidraulico else public.checklist.gato_hidraulico end,
    herramientas = case when p ? 'herramientas' then excluded.herramientas else public.checklist.herramientas end,
    conos_seguridad = case when p ? 'conos_seguridad' then excluded.conos_seguridad else public.checklist.conos_seguridad end,
    extintor = case when p ? 'extintor' then excluded.extintor else public.checklist.extintor end,
    alarma_retroceso = case when p ? 'alarma_retroceso' then excluded.alarma_retroceso else public.checklist.alarma_retroceso end,
    cinturones = case when p ? 'cinturones' then excluded.cinturones else public.checklist.cinturones end,
    cunas_seguridad = case when p ? 'cunas_seguridad' then excluded.cunas_seguridad else public.checklist.cunas_seguridad end,
    lavado_tolva = case when p ? 'lavado_tolva' then excluded.lavado_tolva else public.checklist.lavado_tolva end,
    corte_corriente = case when p ? 'corte_corriente' then excluded.corte_corriente else public.checklist.corte_corriente end,
    aceite_motor = case when p ? 'aceite_motor' then excluded.aceite_motor else public.checklist.aceite_motor end,
    refrigerante = case when p ? 'refrigerante' then excluded.refrigerante else public.checklist.refrigerante end,
    liquido_hidraulico = case when p ? 'liquido_hidraulico' then excluded.liquido_hidraulico else public.checklist.liquido_hidraulico end,
    trampa_agua = case when p ? 'trampa_agua' then excluded.trampa_agua else public.checklist.trampa_agua end,
    fugas = case when p ? 'fugas' then excluded.fugas else public.checklist.fugas end,
    presion_aire = case when p ? 'presion_aire' then excluded.presion_aire else public.checklist.presion_aire end,
    tuercas_esparragos = case when p ? 'tuercas_esparragos' then excluded.tuercas_esparragos else public.checklist.tuercas_esparragos end,
    drenaje_tanques = case when p ? 'drenaje_tanques' then excluded.drenaje_tanques else public.checklist.drenaje_tanques end,
    llanta_repuesto = case when p ? 'llanta_repuesto' then excluded.llanta_repuesto else public.checklist.llanta_repuesto end,
    mangueras_hidraulicas = case when p ? 'mangueras_hidraulicas' then excluded.mangueras_hidraulicas else public.checklist.mangueras_hidraulicas end,
    puntos_engrase = case when p ? 'puntos_engrase' then excluded.puntos_engrase else public.checklist.puntos_engrase end,
    botones_parada = case when p ? 'botones_parada' then excluded.botones_parada else public.checklist.botones_parada end,
    toma_fuerza = case when p ? 'toma_fuerza' then excluded.toma_fuerza else public.checklist.toma_fuerza end,
    danio_frontal = case when p ? 'danio_frontal' then excluded.danio_frontal else public.checklist.danio_frontal end,
    danio_lateral_izq = case when p ? 'danio_lateral_izq' then excluded.danio_lateral_izq else public.checklist.danio_lateral_izq end,
    danio_lateral_der = case when p ? 'danio_lateral_der' then excluded.danio_lateral_der else public.checklist.danio_lateral_der end,
    danio_posterior = case when p ? 'danio_posterior' then excluded.danio_posterior else public.checklist.danio_posterior end,
    danio_techo = case when p ? 'danio_techo' then excluded.danio_techo else public.checklist.danio_techo end,
    observaciones = case when p ? 'observaciones' then excluded.observaciones else public.checklist.observaciones end,
    chofer_km_salida = case when p ? 'chofer_km_salida' then excluded.chofer_km_salida else public.checklist.chofer_km_salida end,
    chofer_km_entrada = case when p ? 'chofer_km_entrada' then excluded.chofer_km_entrada else public.checklist.chofer_km_entrada end,
    chofer_comb_salida = case when p ? 'chofer_comb_salida' then excluded.chofer_comb_salida else public.checklist.chofer_comb_salida end,
    chofer_comb_entrada = case when p ? 'chofer_comb_entrada' then excluded.chofer_comb_entrada else public.checklist.chofer_comb_entrada end,
    chofer_observaciones = case when p ? 'chofer_observaciones' then excluded.chofer_observaciones else public.checklist.chofer_observaciones end,
    chofer_fecha_llenado = case when p ? 'chofer_fecha_llenado' then excluded.chofer_fecha_llenado else public.checklist.chofer_fecha_llenado end,
    estado_vehiculo = case when p ? 'estado_vehiculo' then excluded.estado_vehiculo else public.checklist.estado_vehiculo end,
    llenado_por = 'chofer'
  returning id into v_id;

  return v_id;
end $function$;

commit;

-- ── Control, fuera de la transacción ──
-- ⛔ Se comprueba que `anon` SIGUE pudiendo ejecutar las cuatro. Un permiso perdido no se ve:
--    la migración dice «ok» y el teléfono del chofer deja de guardar al día siguiente.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_puede,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_puede
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('chofer_checklist_dia','chofer_viajes_dia',
                     'chofer_viaje_guardar','chofer_checklist_guardar')
 order by 1;

select 'checklist'     as tabla, count(*) filter (where turno='diurno')   as diurnos,
       count(*) filter (where turno='nocturno') as nocturnos from public.checklist
union all
select 'viajes_chofer', count(*) filter (where turno='diurno'),
       count(*) filter (where turno='nocturno') from public.viajes_chofer
union all
select 'cuadrilla_dia', count(*) filter (where turno='diurno'),
       count(*) filter (where turno='nocturno') from public.cuadrilla_dia;
