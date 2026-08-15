-- ════════════════════════════════════════════════════════════════════════════════════════════
--  RÉPLICA A BETANGAR de la migración homónima de `flotilla-app` (15/08/2026).
--  Se comprobó ANTES de copiar que las 4 tablas del chofer son IDÉNTICAS en las dos bases:
--  102 columnas cada una, cero diferencias, y los 4 índices únicos con el mismo nombre.
--  Por eso va sin adaptar. El texto original sigue abajo tal cual.
--  ⚠️ Esta base la comparte GEPPETTO (tablas edu_* / usdt_*): nada de esto las toca.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  LAS ESCRITURAS DEL CHOFER PASAN POR RPC  ·  FLOTILLA
--  15/08/2026
--
--  POR QUÉ
--  La llave `anon` está en el JS público: la tiene cualquiera que abra la página. Con ella se
--  puede LEER la operación completa del cliente (viajes, checklist, odómetro, mediciones). Las
--  RPC de lectura se pusieron el 14/08 y el cliente ya las usa desde hoy — pero el permiso de
--  lectura NO se puede quitar mientras las escrituras vayan directo a la tabla:
--
--    · Un UPDATE que filtra por columnas en el WHERE exige privilegio SELECT.
--      Medido el 15/08 contra una tabla de descarte: sin SELECT, un PATCH filtrado da 401.
--    · Y si en vez del permiso se quita la POLÍTICA de SELECT, es peor: el UPDATE responde
--      204 y NO ESCRIBE NADA. `res.error` queda en null, la pantalla dice «guardado» y la
--      flota reporta un día que la base no tiene.
--
--  Por eso el cierre real es éste: que la escritura NO necesite la tabla. Estas funciones son
--  `security definer` —corren con los permisos del dueño—, así que después de esto se le puede
--  revocar TODO a `anon` sobre las 4 tablas.
--
--  ⛔ LO QUE EL CHOFER NO PUEDE ESCRIBIR, Y POR QUÉ VA ACÁ Y NO EN EL CLIENTE
--  Un candado en el JS no es un candado: el que tiene la llave llama a la RPC como quiera. Por eso
--  las columnas que decide OTRO se fijan del lado del servidor:
--    · `llenado_por` se fuerza a 'chofer' — el chofer no puede hacerse pasar por el mecánico;
--    · `mecanico`, `supervisor` y `mecanico_fecha_llenado` no se tocan NUNCA desde acá;
--    · si el checklist del día ya lo llenó el mecánico, la función NO pisa nada y devuelve null;
--    · el odómetro NUNCA baja (`km_data.km` solo sube);
--    · `estado_confirmado` lo declara una PERSONA de oficina: acá solo se BAJA, nunca se sube.
--
--  Es idempotente: se puede correr de nuevo sin romper nada.
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. UN VIAJE ─────────────────────────────────────────────────────────────────────────────
create or replace function public.chofer_viaje_guardar(p jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(p->>'cam','') = '' or coalesce(p->>'fecha','') = '' or (p->>'viaje_num') is null then
    raise exception 'cam, fecha y viaje_num son obligatorios';
  end if;
  insert into public.viajes_chofer (fecha, cam, chofer, viaje_num, hora, sincronizado)
  values (p->>'fecha', p->>'cam', p->>'chofer', (p->>'viaje_num')::int, p->>'hora', true)
  on conflict (fecha, cam, viaje_num) do update
     set chofer = excluded.chofer,
         hora   = excluded.hora,
         sincronizado = true;
end $fn$;

-- ── 2. EL CHECKLIST DEL DÍA ─────────────────────────────────────────────────────────────────
-- Devuelve el `id` de la fila, o NULL si el mecánico ya lo llenó (ahí el chofer no pisa nada).
-- El id se devuelve porque la pantalla lo necesita para saber si está editando; no abre la tabla.
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

  select llenado_por into v_quien
    from public.checklist where cam = v_cam and fecha = v_fecha;

  -- ⛔ El mecánico manda: si ya lo llenó él, esto no escribe NADA.
  if v_quien = 'mecanico' then
    return null;
  end if;

  -- jsonb_populate_record ignora las claves que no son columnas y castea las que sí. Las columnas
  -- del mecánico no están en la lista de abajo, así que aunque vengan en `p` no se escriben.
  r := jsonb_populate_record(null::public.checklist, p);

  insert into public.checklist (
    fecha, cam, conductor, km_salida, km_entrada, hora_salida, hora_entrada, comb_salida,
    comb_entrada, luz_delantera_alta, luz_delantera_baja, luces_emergencia, luces_neblineros,
    luz_direccional, luz_freno_posterior, parabrisas_del, parabrisas_pos, limpia_parabrisas,
    vidrio_parabrisas, espejos_laterales, tablero_indicadores, freno_mano, freno_servicio,
    aceite_refrigerante, espejo_retrovisor, tapa_combustible, gato_hidraulico, herramientas,
    conos_seguridad, extintor, alarma_retroceso, cinturones, cunas_seguridad, lavado_tolva,
    corte_corriente, aceite_motor, refrigerante, liquido_hidraulico, trampa_agua, fugas,
    presion_aire, tuercas_esparragos, drenaje_tanques, llanta_repuesto, mangueras_hidraulicas,
    puntos_engrase, botones_parada, toma_fuerza, danio_frontal, danio_lateral_izq,
    danio_lateral_der, danio_posterior, danio_techo, observaciones, chofer_km_salida,
    chofer_km_entrada, chofer_comb_salida, chofer_comb_entrada, chofer_observaciones,
    chofer_fecha_llenado, estado_vehiculo,
    llenado_por
  ) values (
    r.fecha, r.cam, r.conductor, r.km_salida, r.km_entrada, r.hora_salida, r.hora_entrada,
    r.comb_salida, r.comb_entrada, r.luz_delantera_alta, r.luz_delantera_baja,
    r.luces_emergencia, r.luces_neblineros, r.luz_direccional, r.luz_freno_posterior,
    r.parabrisas_del, r.parabrisas_pos, r.limpia_parabrisas, r.vidrio_parabrisas,
    r.espejos_laterales, r.tablero_indicadores, r.freno_mano, r.freno_servicio,
    r.aceite_refrigerante, r.espejo_retrovisor, r.tapa_combustible, r.gato_hidraulico,
    r.herramientas, r.conos_seguridad, r.extintor, r.alarma_retroceso, r.cinturones,
    r.cunas_seguridad, r.lavado_tolva, r.corte_corriente, r.aceite_motor, r.refrigerante,
    r.liquido_hidraulico, r.trampa_agua, r.fugas, r.presion_aire, r.tuercas_esparragos,
    r.drenaje_tanques, r.llanta_repuesto, r.mangueras_hidraulicas, r.puntos_engrase,
    r.botones_parada, r.toma_fuerza, r.danio_frontal, r.danio_lateral_izq, r.danio_lateral_der,
    r.danio_posterior, r.danio_techo, r.observaciones, r.chofer_km_salida, r.chofer_km_entrada,
    r.chofer_comb_salida, r.chofer_comb_entrada, r.chofer_observaciones, r.chofer_fecha_llenado,
    r.estado_vehiculo,
    'chofer'
  )
  on conflict (fecha, cam) do update set
    conductor = excluded.conductor, km_salida = excluded.km_salida,
    km_entrada = excluded.km_entrada, hora_salida = excluded.hora_salida,
    hora_entrada = excluded.hora_entrada, comb_salida = excluded.comb_salida,
    comb_entrada = excluded.comb_entrada, luz_delantera_alta = excluded.luz_delantera_alta,
    luz_delantera_baja = excluded.luz_delantera_baja, luces_emergencia = excluded.luces_emergencia,
    luces_neblineros = excluded.luces_neblineros, luz_direccional = excluded.luz_direccional,
    luz_freno_posterior = excluded.luz_freno_posterior, parabrisas_del = excluded.parabrisas_del,
    parabrisas_pos = excluded.parabrisas_pos, limpia_parabrisas = excluded.limpia_parabrisas,
    vidrio_parabrisas = excluded.vidrio_parabrisas, espejos_laterales = excluded.espejos_laterales,
    tablero_indicadores = excluded.tablero_indicadores, freno_mano = excluded.freno_mano,
    freno_servicio = excluded.freno_servicio, aceite_refrigerante = excluded.aceite_refrigerante,
    espejo_retrovisor = excluded.espejo_retrovisor, tapa_combustible = excluded.tapa_combustible,
    gato_hidraulico = excluded.gato_hidraulico, herramientas = excluded.herramientas,
    conos_seguridad = excluded.conos_seguridad, extintor = excluded.extintor,
    alarma_retroceso = excluded.alarma_retroceso, cinturones = excluded.cinturones,
    cunas_seguridad = excluded.cunas_seguridad, lavado_tolva = excluded.lavado_tolva,
    corte_corriente = excluded.corte_corriente, aceite_motor = excluded.aceite_motor,
    refrigerante = excluded.refrigerante, liquido_hidraulico = excluded.liquido_hidraulico,
    trampa_agua = excluded.trampa_agua, fugas = excluded.fugas,
    presion_aire = excluded.presion_aire, tuercas_esparragos = excluded.tuercas_esparragos,
    drenaje_tanques = excluded.drenaje_tanques, llanta_repuesto = excluded.llanta_repuesto,
    mangueras_hidraulicas = excluded.mangueras_hidraulicas, puntos_engrase = excluded.puntos_engrase,
    botones_parada = excluded.botones_parada, toma_fuerza = excluded.toma_fuerza,
    danio_frontal = excluded.danio_frontal, danio_lateral_izq = excluded.danio_lateral_izq,
    danio_lateral_der = excluded.danio_lateral_der, danio_posterior = excluded.danio_posterior,
    danio_techo = excluded.danio_techo, observaciones = excluded.observaciones,
    chofer_km_salida = excluded.chofer_km_salida, chofer_km_entrada = excluded.chofer_km_entrada,
    chofer_comb_salida = excluded.chofer_comb_salida,
    chofer_comb_entrada = excluded.chofer_comb_entrada,
    chofer_observaciones = excluded.chofer_observaciones,
    chofer_fecha_llenado = excluded.chofer_fecha_llenado,
    estado_vehiculo = excluded.estado_vehiculo,
    llenado_por = 'chofer'
  returning id into v_id;

  return v_id;
end $fn$;

-- ── 3. ESTADO DE LA UNIDAD (lo que antes hacía _kmDataAplicarEstado en el teléfono) ─────────
-- La lógica se mueve entera al servidor: era una lectura + una decisión + una escritura, o sea
-- tres viajes de red y dos permisos de tabla para una sola cosa.
create or replace function public.chofer_km_estado(
  p_cam text, p_estado text, p_motivo text, p_observ text, p_quien text, p_fecha text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_prev  public.km_data;
  v_eraop boolean;
  v_desde date;
  v_nota  text;
begin
  if coalesce(p_cam,'') = '' then raise exception 'cam es obligatorio'; end if;

  -- ⛔ La cola puede subir un checklist de hace días DESPUÉS de uno más nuevo. El dato viejo es
  -- legítimo, pero su EFECTO sobre el estado de hoy no: pondría a la unidad como estaba el martes.
  if exists (select 1 from public.checklist where cam = p_cam and fecha > p_fecha) then
    return;
  end if;

  select * into v_prev from public.km_data where cam = p_cam;
  v_eraop := (v_prev.estado is null or v_prev.estado = 'operativo');

  if p_estado = 'operativo' then
    v_desde := null; v_nota := '';                    -- vuelve a circular: sin fecha y sin motivo
  else
    v_desde := case when (not v_eraop and v_prev.estado_desde is not null)
                    then v_prev.estado_desde else p_fecha::date end;
    v_nota  := coalesce(nullif(btrim(coalesce(p_motivo,'')),''),
                        nullif(btrim(coalesce(p_observ,'')),''),
                        btrim(coalesce(v_prev.nota_estado,'')));
  end if;

  insert into public.km_data (cam, estado, nota_estado, estado_desde, estado_confirmado, updated_by)
  values (p_cam, p_estado, v_nota, v_desde,
          case when p_estado <> 'operativo' then false else null end,
          nullif(p_quien,''))
  on conflict (cam) do update set
    estado       = excluded.estado,
    nota_estado  = excluded.nota_estado,
    estado_desde = excluded.estado_desde,
    -- solo se BAJA: que la unidad vuelva a circular no confirma nada, eso lo declara la oficina
    estado_confirmado = case when p_estado <> 'operativo' then false
                             else public.km_data.estado_confirmado end,
    updated_by   = coalesce(nullif(p_quien,''), public.km_data.updated_by);
end $fn$;

-- ── 4. EL ODÓMETRO, QUE NUNCA BAJA ──────────────────────────────────────────────────────────
create or replace function public.chofer_km_subir(p_cam text, p_km integer)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(p_cam,'') = '' or coalesce(p_km,0) <= 0 then return; end if;
  update public.km_data set km = p_km
   where cam = p_cam and (km is null or km < p_km);
end $fn$;

-- ── 5. LA MEDICIÓN DEL TANQUE ───────────────────────────────────────────────────────────────
create or replace function public.chofer_medicion_guardar(p jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(p->>'vehiculo_id','') = '' or coalesce(p->>'fecha','') = ''
     or coalesce(p->>'momento','') = '' then
    raise exception 'vehiculo_id, fecha y momento son obligatorios';
  end if;
  insert into public.combustible_mediciones
    (fecha, tanque_id, vehiculo_id, momento, altura_cm, litros_calculados, registrado_por, notas)
  values (
    (p->>'fecha')::date, p->>'tanque_id', p->>'vehiculo_id', p->>'momento',
    (p->>'altura_cm')::numeric,
    case when p->>'litros_calculados' is null then null
         else (p->>'litros_calculados')::numeric end,
    p->>'registrado_por', p->>'notas')
  on conflict (vehiculo_id, fecha, momento) do update set
    tanque_id         = excluded.tanque_id,
    altura_cm         = excluded.altura_cm,
    litros_calculados = excluded.litros_calculados,
    registrado_por    = excluded.registrado_por,
    notas             = excluded.notas;
end $fn$;

-- ── 6. QUIÉN LAS PUEDE LLAMAR ───────────────────────────────────────────────────────────────
grant execute on function public.chofer_viaje_guardar(jsonb)      to anon;
grant execute on function public.chofer_checklist_guardar(jsonb)  to anon;
grant execute on function public.chofer_km_estado(text,text,text,text,text,text) to anon;
grant execute on function public.chofer_km_subir(text,integer)    to anon;
grant execute on function public.chofer_medicion_guardar(jsonb)   to anon;

commit;

-- ════════════════════════════════════════════════════════════════════════════════════════════
--  ⛔ EL CIERRE DE LAS TABLAS VA APARTE, Y DESPUÉS DE DESPLEGAR EL CLIENTE NUEVO
--  Correr el cierre ANTES de que `chofer.html` use estas RPC deja a la flota sin registrar nada.
--  Orden: (1) este archivo · (2) desplegar `chofer.html` · (3) comprobar · (4) el cierre.
-- ════════════════════════════════════════════════════════════════════════════════════════════
