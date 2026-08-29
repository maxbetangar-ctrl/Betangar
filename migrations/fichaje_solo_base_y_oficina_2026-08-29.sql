-- BETANGAR — Fichar solo se ficha en la BASE o la OFICINA, no en el vertedero
-- Fecha: 2026-08-29
--
-- QUÉ PASÓ. Máximo avisó que iba a marcar las geocercas de las estaciones de servicio,
-- y ahí se vio el efecto lateral de todo lo de hoy: `fichar_asistencia` elige el sitio
-- así —medido leyendo su cuerpo—:
--
--     where coalesce(s.activo,true)=true  order by dist asc limit 1
--
-- **No filtra por tipo.** Cualquier sitio activo habilita fichar desde ahí. O sea que
-- desde que se marcaron los dos vertederos, un empleado puede marcar entrada parado en
-- el vertedero; y con las estaciones marcadas, podría fichar desde una bomba de gasolina.
--
-- ⚠️ Nadie decidió eso: es una consecuencia de haber usado la misma tabla para las
-- geocercas del GPS y para las sedes de asistencia. La tabla se llama
-- `sitios_asistencia` justamente porque nació para lo otro.
--
-- Y hay un segundo efecto, peor de detectar: el modo general toma el sitio ACTIVO MÁS
-- CERCANO y recién después valida el radio. Un vertedero cerca de una sede puede ganarle
-- la cercanía y hacer que el fichaje quede registrado en el sitio equivocado, sin error.
--
-- QUÉ CAMBIA. Los modos QR y general solo consideran sitios de tipo `base` u `oficina`.
--
-- ⛔ `coalesce(tipo,'base')`: un sitio viejo sin tipo se trata como base. Los sitios que
-- existían antes de que hubiera tipos ERAN la base y la oficina; tratarlos como «tipo
-- desconocido → no se ficha» dejaría gente sin poder marcar por un dato que nadie llenó.
--
-- ⛔ El MODO CHECKLIST NO se toca. Ahí el sitio es informativo —etiqueta dónde estaba el
-- chofer cuando llenó el checklist— y que diga «en el vertedero» es exactamente lo que
-- se quiere. El checklist ES la asistencia del chofer y siempre se registra.
--
-- VERIFICADO ANTES DE APLICAR, contra los sitios activos: PATIO BETANGAR es `base` y
-- BETANGAR 5 DE JULIO es `oficina`, así que los dos siguen habilitando fichaje. Los que
-- salen son los dos vertederos, donde nunca fichó nadie (los 1.339 fichajes son de la
-- base y la oficina).
--
-- Reversa: recrear la función sacando las dos condiciones `coalesce(tipo,'base') in (...)`.

CREATE OR REPLACE FUNCTION public.fichar_asistencia(p_id text, p_clave text, p_lat double precision, p_lng double precision, p_selfie text DEFAULT NULL::text, p_origen text DEFAULT 'fichaje'::text, p_unidad text DEFAULT NULL::text, p_sitio_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_nombre text; v_cargo text; v_ced4 text; v_best record; v_dist double precision;
        v_sitio_id bigint; v_sitio_nombre text;
begin
  select nombre, cargo, right(regexp_replace(coalesce(cedula,''),'[^0-9]','','g'),4)
    into v_nombre, v_cargo, v_ced4
  from public.empleados where id = p_id and coalesce(activo,true)=true;
  if v_nombre is null then return jsonb_build_object('ok',false,'msg','Empleado no encontrado'); end if;
  if v_ced4 is null or v_ced4 <> right(regexp_replace(coalesce(p_clave,''),'[^0-9]','','g'),4) then
    return jsonb_build_object('ok',false,'msg','Clave (4 dígitos) incorrecta'); end if;

  -- CUALQUIER empleado activo ficha en CUALQUIERA de las sedes activas (oficina o galpón).
  -- La única barrera es la geocerca por radio (no se ficha desde la casa). Antes el personal de
  -- oficina (RRHH/administración) estaba atado a sitios es_oficina=true y no podía fichar en el
  -- galpón (bug Gladys 2026-07-22). El campo es_oficina queda solo como etiqueta informativa.
  if p_sitio_id is not null then
    -- MODO QR: la sucursal viene del QR físico pegado en el sitio (prueba de presencia). GPS = verificación TOLERANTE.
    select * into v_best from public.sitios_asistencia
     where id = p_sitio_id and coalesce(activo,true)=true and coalesce(tipo,'base') in ('base','oficina');
    if v_best is null then return jsonb_build_object('ok',false,'msg','El sitio del QR no existe o está inactivo'); end if;
    if p_lat is not null and p_lng is not null then
      v_dist := 2*6371000*asin(sqrt(power(sin(radians((p_lat - v_best.lat)/2)),2)+cos(radians(v_best.lat))*cos(radians(p_lat))*power(sin(radians((p_lng - v_best.lng)/2)),2)));
      if v_dist > greatest(v_best.radio_m*3, 1500) then
        return jsonb_build_object('ok',false,'msg','El GPS te ubica lejos de '||v_best.nombre||' (a '||round(v_dist)||' m). Escaneá el QR estando en el sitio.');
      end if;
    end if;
    v_sitio_id := v_best.id; v_sitio_nombre := v_best.nombre;
  elsif p_origen = 'checklist' then
    -- MODO CHECKLIST: el checklist ES la asistencia del chofer -> SIEMPRE se registra (sin checklist = sin asistencia).
    -- Etiqueta el sitio más cercano solo si está razonablemente cerca (informativo); si no, queda sin sitio (en ruta).
    if p_lat is not null and p_lng is not null then
      select s.*, (2*6371000*asin(sqrt(power(sin(radians((p_lat - s.lat)/2)),2)+cos(radians(s.lat))*cos(radians(p_lat))*power(sin(radians((p_lng - s.lng)/2)),2)))) as dist
        into v_best from public.sitios_asistencia s where coalesce(s.activo,true)=true order by dist asc limit 1;
      if v_best is not null and v_best.dist <= greatest(v_best.radio_m*3, 2000) then
        v_sitio_id := v_best.id; v_sitio_nombre := v_best.nombre;
      end if;
    end if;
  else
    -- MODO GENERAL (sin QR): geocerca ESTRICTA, auto-detecta la sede ACTIVA más cercana (cualquier rol).
    select s.*, (2*6371000*asin(sqrt(
        power(sin(radians((p_lat - s.lat)/2)),2) +
        cos(radians(s.lat))*cos(radians(p_lat))*power(sin(radians((p_lng - s.lng)/2)),2)
      ))) as dist
      into v_best
    from public.sitios_asistencia s
    where coalesce(s.activo,true)=true
      and coalesce(s.tipo,'base') in ('base','oficina')
    order by dist asc limit 1;
    if v_best is null then return jsonb_build_object('ok',false,'msg','No hay sitios de asistencia activos'); end if;
    if v_best.dist > v_best.radio_m then
      return jsonb_build_object('ok',false,'msg','No estás en un sitio autorizado (a '||round(v_best.dist)||' m del más cercano)');
    end if;
    v_sitio_id := v_best.id; v_sitio_nombre := v_best.nombre;
  end if;

  insert into public.asistencia_dia (fecha, empleado_id, nombre, cargo, sitio_id, sitio_nombre, lat, lng, selfie_url, origen, unidad, hora)
  values ((now() at time zone 'America/Caracas')::date, p_id, v_nombre, v_cargo, v_sitio_id, v_sitio_nombre, p_lat, p_lng, p_selfie, coalesce(p_origen,'fichaje'), p_unidad, now())
  on conflict (fecha, empleado_id) do update set
    sitio_id=coalesce(excluded.sitio_id, public.asistencia_dia.sitio_id),
    sitio_nombre=coalesce(excluded.sitio_nombre, public.asistencia_dia.sitio_nombre),
    lat=excluded.lat, lng=excluded.lng,
    selfie_url=coalesce(excluded.selfie_url, public.asistencia_dia.selfie_url),
    origen=excluded.origen, unidad=coalesce(excluded.unidad, public.asistencia_dia.unidad), hora=excluded.hora;

  return jsonb_build_object('ok',true,'sitio',v_sitio_nombre,'nombre',v_nombre,'msg','Asistencia registrada'||coalesce(' en '||v_sitio_nombre,' (checklist)'));
end $function$
;
