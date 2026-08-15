-- ════════════════════════════════════════════════════════════════════════════════════════════
--  ⛔ ARREGLO URGENTE: EL UPSERT DEL CHECKLIST BORRABA LA SALIDA AL GUARDAR LA LLEGADA
--  15/08/2026 · 17:4x
--
--  QUÉ ROMPÍ, Y CÓMO SE VIO
--  `chofer_checklist_guardar` (de hoy mismo) reemplazó a un `.update(registro)` de PostgREST.
--  Esa diferencia parecía cosmética y NO LO ERA:
--
--    · PostgREST `.update(obj)` escribe SOLO las claves que vienen en el objeto.
--    · Mi `insert ... on conflict do update set <las 59 columnas> = excluded.<col>` escribe
--      TODAS: las que el cliente no mandó entraban como NULL y PISABAN lo que había.
--
--  La pantalla de LLEGADA manda km_entrada/hora_entrada y no manda km_salida/hora_salida —
--  ésas se llenaron a las 5 de la mañana. Así que **cada camión que registró su llegada perdió
--  su salida**.
--
--  Se vio porque el vigilante de la flota contaba «unidades que salieron hoy» con
--  `km_salida > 0` y ese número BAJABA: 10 → 9 → 8. Una unidad que salió no puede des-salir.
--  Sin ese contador el daño pasaba desapercibido hasta que alguien buscara el km del día.
--
--  EL ARREGLO
--  `p ? 'columna'` pregunta si la clave VINO en el JSON. Si vino, se escribe; si no, se deja lo
--  que había. Eso reproduce exactamente lo que hacía PostgREST.
--
--  ⚠️ NO se usa `coalesce(excluded.col, actual)`: eso haría imposible BORRAR un valor a
--     propósito. La pregunta correcta no es «¿vino vacío?» sino «¿vino?».
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.chofer_checklist_guardar(p jsonb)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_cam   text := p->>'cam';
  v_fecha text := p->>'fecha';
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
    from public.checklist where cam = v_cam and fecha = v_fecha;

  -- ⛔ El mecánico manda: si ya lo llenó él, esto no escribe NADA.
  if v_quien = 'mecanico' then
    return null;
  end if;

  r := jsonb_populate_record(null::public.checklist, p);

  insert into public.checklist (
    fecha,
    cam,
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
  on conflict (fecha, cam) do update set
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
end $fn$;

commit;

-- ── COMPROBACIÓN ────────────────────────────────────────────────────────────────────────────
-- Guardar una llegada NO puede tocar la salida. Con una fila de prueba:
--   1) guardar {cam, fecha, km_salida: 100, hora_salida: '05:00'}
--   2) guardar {cam, fecha, km_entrada: 200}
--   3) km_salida tiene que seguir en 100.
