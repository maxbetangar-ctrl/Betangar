-- ════════════════════════════════════════════════════════════════════════════════════════════
--  EL MISMO CANDADO EN LAS OTRAS DOS RPC CON UPSERT
--  15/08/2026 · 18:0x
--
--  POR QUÉ, SI HOY NO FALLARON
--  `chofer_checklist_guardar` borró la salida de dos camiones de Betangar porque su
--  `on conflict do update set` escribía TODAS las columnas y las que el cliente no mandaba
--  entraban como NULL. `chofer_viaje_guardar` y `chofer_medicion_guardar` tienen el MISMO
--  `do update set` completo — y hoy no rompieron nada solo porque sus pantallas arman el objeto
--  entero cada vez.
--
--  ⛔ ESO ES SUERTE, NO DISEÑO. Basta que mañana alguien mande una corrección parcial —«solo el
--     litro», «solo la hora»— para que se lleve puesto el resto. El defecto no es del checklist:
--     es de la forma `upsert con todas las columnas`, y donde está la forma está el defecto.
--
--  `p ? 'columna'` pregunta si la clave VINO en el JSON. Si vino, se escribe; si no, se deja lo
--  que había. Es exactamente lo que hacía el `.update(obj)` de PostgREST que estas funciones
--  reemplazaron.
--
--  ⚠️ NO se usa `coalesce(excluded.col, actual)`: eso haría imposible borrar un valor a propósito.
--     La pregunta correcta no es «¿vino vacío?» sino «¿vino?».
-- ════════════════════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.chofer_viaje_guardar(p jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(p->>'cam','') = '' or coalesce(p->>'fecha','') = '' or (p->>'viaje_num') is null then
    raise exception 'cam, fecha y viaje_num son obligatorios';
  end if;
  if not public.chofer_puede_ver(p->>'cam') then
    raise exception 'esa unidad no es la suya';
  end if;
  insert into public.viajes_chofer (fecha, cam, chofer, viaje_num, hora, sincronizado)
  values (p->>'fecha', p->>'cam', p->>'chofer', (p->>'viaje_num')::int, p->>'hora', true)
  on conflict (fecha, cam, viaje_num) do update set
    chofer = case when p ? 'chofer' then excluded.chofer else public.viajes_chofer.chofer end,
    hora   = case when p ? 'hora'   then excluded.hora   else public.viajes_chofer.hora   end,
    sincronizado = true;
end $fn$;

create or replace function public.chofer_medicion_guardar(p jsonb)
returns void
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(p->>'vehiculo_id','') = '' or coalesce(p->>'fecha','') = ''
     or coalesce(p->>'momento','') = '' then
    raise exception 'vehiculo_id, fecha y momento son obligatorios';
  end if;
  if not public.chofer_puede_ver(p->>'vehiculo_id') then
    raise exception 'esa unidad no es la suya';
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
    tanque_id = case when p ? 'tanque_id' then excluded.tanque_id
                     else public.combustible_mediciones.tanque_id end,
    altura_cm = case when p ? 'altura_cm' then excluded.altura_cm
                     else public.combustible_mediciones.altura_cm end,
    litros_calculados = case when p ? 'litros_calculados' then excluded.litros_calculados
                             else public.combustible_mediciones.litros_calculados end,
    registrado_por = case when p ? 'registrado_por' then excluded.registrado_por
                          else public.combustible_mediciones.registrado_por end,
    notas = case when p ? 'notas' then excluded.notas
                 else public.combustible_mediciones.notas end;
end $fn$;

commit;

-- ── COMPROBACIÓN ────────────────────────────────────────────────────────────────────────────
-- Guardar un viaje con solo {fecha,cam,viaje_num} NO puede borrarle el chofer ni la hora.
