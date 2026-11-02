-- ═══════════════════════════════════════════════════════════════════════════
-- LOS BARRIOS QUE LA GENTE NOMBRA — y donde estuvo el camion ese dia
--
-- 🔴 POR QUE EXISTE (02/11/2026). El chofer Alexander escribio el 31/10:
--    *«yo hoy tenia Pinto Salina y Reinaldo Amaya y nuevo orisonte»*.
--    Medido ese dia: **ninguno de los tres nombres existe en las 2.255 filas de
--    `calles`**, que estan nombradas por numero (Calle 74, Avenida 3E). Y el
--    `cronograma_recoleccion` trabaja por PARROQUIA, no por barrio. O sea:
--    **el chofer y el sistema hablan dos idiomas distintos.**
--
--    Lo que eso cuesta, concreto: cuando el IMAU denuncia *«no recogieron en
--    Pinto Salina»*, el sistema **no puede contestar**, porque ese nombre no
--    esta en ninguna parte. Una denuncia con UBICACION si se contesta
--    (`gps_denuncia_en_punto`, 30/10); una con NOMBRE DE BARRIO, no.
--
-- ⛔ Y POR QUE ESTO NO INVENTA POLIGONOS DE BARRIO. No tenemos el callejero por
--    barrio y no hay de donde sacarlo sin traerlo de afuera. Lo que SI tenemos
--    es mejor que una suposicion: **lo que una persona declaro, con fecha, y
--    donde estuvo su camion ese dia**. Un barrio entra aca con su prueba:
--    quien lo dijo, cuando, que unidad manejaba y el rectangulo que cubrieron
--    sus posiciones de GPS ese dia. Eso no es el barrio: es **donde estaba el
--    camion cuando el dijo que estaba en ese barrio**, y la diferencia se
--    escribe en la tabla para que nadie la olvide.
--    [[norma-falta-de-dato-no-es-un-dato]]
--
-- ⛔ UN NOMBRE SE GUARDA COMO LA PERSONA LO DIJO, y aparte normalizado para
--    poder buscarlo: «nuevo orisonte» tiene que encontrar «Nuevo Horizonte».
--    Si se guardara solo el normalizado se perderia como habla la gente, y si se
--    guardara solo el original no se podria buscar nunca.
--
-- ⚠️ ESTO NO REEMPLAZA PREGUNTARLE AL CHOFER cuales calles son. Lo que hace es
--    que la proxima denuncia por nombre tenga ALGO que contestar, con su
--    evidencia y su fecha, en vez de un silencio.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ⛔ SE BUSCA POR PARECIDO, NO POR IGUALDAD (02/11/2026). El chofer escribió
--    **«nuevo orisonte»** y yo lo sembré como «Nuevo Horizonte» — o sea le
--    corregí la ortografía, justo lo que esta tabla dice que no hay que hacer—.
--    Al probar el buscador con SUS palabras contestó «no está en el sistema»:
--    la normalización saca tildes y mayúsculas, no arregla cómo se escribe.
--    ⇒ Con `pg_trgm`, «nuevo orisonte» encuentra «nuevo horizonte» y «Reinaldo
--    amya» encuentra «Reinaldo Amaya». Una denuncia del IMAU o un mensaje de un
--    chofer vienen escritos a mano: exigir la ortografía exacta es exigir que la
--    gente escriba como la base. [[norma-la-palabra-que-identifica-es-la-rara]]
create extension if not exists pg_trgm;

create table if not exists public.barrios_dichos (
  id            bigserial primary key,
  -- Como lo dijo la persona, tal cual.
  nombre        text not null,
  -- Para buscar: minusculas, sin tildes, sin dobles espacios.
  nombre_busca  text not null,
  -- La prueba: quien, cuando, y con que unidad.
  declarado_por text,
  telefono      text,
  dicho_en      timestamptz not null,
  cam           text,
  fecha         date,
  -- Lo que el sistema ya sabia de ese camion ese dia.
  parroquia     text,
  zona          smallint,
  -- El rectangulo que cubrieron sus posiciones ese dia. NO es el barrio: es
  -- donde estuvo el camion. Se guarda como jsonb para no atar esto a PostGIS.
  caja          jsonb,
  posiciones    integer,
  nota          text,
  creado        timestamptz not null default now(),
  unique (nombre_busca, telefono, fecha)
);

comment on table public.barrios_dichos is
  'Barrios que una persona nombro, con la prueba de donde estaba su camion ese dia. NO es un callejero por barrio: es lo declarado + lo medido. Sirve para que una denuncia por NOMBRE tenga algo que contestar.';
comment on column public.barrios_dichos.caja is
  'Rectangulo de las posiciones de GPS de ESE camion ESE dia, solo las de <= 15 km/h (recogiendo). ⛔ NO es el limite del barrio Y NO SIRVE PARA UBICARLO: medido el 02/11/2026 con la JAC-B005, da 12 x 19 km -la ciudad entera- incluso filtrando por recogiendo (470 de 599 posiciones). El motivo NO es la velocidad (max 87 km/h, promedio 13: son km/h, no nudos) sino que esa unidad trabaja DOS parroquias en el mismo dia (Caracciolo zona 8 y Venancio Pulgar zona 10). Lo que si vale de esta fila es quien lo dijo, cuando, con que unidad y que zonas tenia: para ubicar un punto hace falta la UBICACION.';

-- ⛔ TODA FUNCION NACE ABIERTA A `public`: lo que no se revoca queda abierto.
revoke all on table public.barrios_dichos from public, anon;
grant select on table public.barrios_dichos to authenticated, service_role;
grant insert, update on table public.barrios_dichos to service_role;
grant usage, select on sequence public.barrios_dichos_id_seq to service_role;

-- ── Normalizar un nombre para poder buscarlo ───────────────────────────────
create or replace function public.barrio_normaliza(p text)
returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select regexp_replace(
           lower(translate(coalesce(p,''),
             'áàäâãéèëêíìïîóòöôõúùüûñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑ',
             'aaaaaeeeeiiiiooooouuuunAAAAAEEEEIIIIOOOOOUUUUN')),
           '\s+', ' ', 'g')
$function$;

-- ── Guardar un barrio dicho, con su prueba ─────────────────────────────────
-- Se le pasa el nombre, quien lo dijo y cuando; la caja y la zona las MIDE la
-- funcion, no quien llama: asi nadie puede declarar un barrio en una zona que
-- su camion no piso ese dia.
create or replace function public.barrio_dicho_guardar(
  p_nombre text,
  p_telefono text,
  p_dicho_en timestamptz,
  p_cam text default null,
  p_nota text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fecha date;
  v_cam text;
  v_quien text;
  v_caja jsonb;
  v_n integer;
  v_parroquia text;
  v_zona smallint;
  v_id bigint;
begin
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'un barrio sin nombre no se guarda';
  end if;

  v_fecha := (p_dicho_en at time zone 'America/Caracas')::date;

  -- La unidad: la que se pase, o la que ese dia tuvo el checklist de esa persona.
  v_cam := p_cam;
  if v_cam is null then
    select c.cam into v_cam
      from checklist c
      join empleados e on public.barrio_normaliza(e.nombre) = public.barrio_normaliza(c.conductor)
     -- ⚠️ `checklist.fecha` es TEXT, no date: se compara convertido. Sin esto el
     --    guardado revienta con «operator does not exist: text = date».
     where c.fecha::date = v_fecha
       and right(regexp_replace(coalesce(e.whatsapp, e.tel, ''), '\D', '', 'g'), 10)
           = right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10)
     limit 1;
  end if;

  -- Quien lo dijo, por su ficha. Si no esta fichado, queda el telefono.
  select e.nombre into v_quien
    from empleados e
   where right(regexp_replace(coalesce(e.whatsapp, e.tel, ''), '\D', '', 'g'), 10)
       = right(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g'), 10)
   limit 1;

  -- La caja de SUS posiciones ESE dia. Si no hay GPS, queda null y se nota.
  if v_cam is not null then
    -- ⛔ SOLO LAS POSICIONES RECOGIENDO, NO LAS DEL DIA ENTERO (medido el
    --    02/11/2026). La primera version uso todas las posiciones del dia y la
    --    caja salio de 13 x 19 km — la ciudad entera— porque adentro esta el
    --    viaje al vertedero. Una caja asi es honesta y no sirve para nada.
    --    El criterio de «recogiendo» ya existe en esta casa y es el que usa
    --    `zona_cobertura_del_dia`: velocidad <= 15 km/h es recoger, mas que eso
    --    es cruzar. Se guardan las dos cuentas para que se vea la diferencia.
    select jsonb_build_object(
             'lat_min', round(min(lat) filter (where coalesce(velocidad,0) <= 15)::numeric, 6),
             'lat_max', round(max(lat) filter (where coalesce(velocidad,0) <= 15)::numeric, 6),
             'lon_min', round(min(lon) filter (where coalesce(velocidad,0) <= 15)::numeric, 6),
             'lon_max', round(max(lon) filter (where coalesce(velocidad,0) <= 15)::numeric, 6),
             'criterio', 'posiciones a <= 15 km/h (recogiendo, no cruzando)',
             'posiciones_recogiendo', count(*) filter (where coalesce(velocidad,0) <= 15),
             'posiciones_del_dia', count(*)),
           count(*) filter (where coalesce(velocidad,0) <= 15)
      into v_caja, v_n
      -- `gps_posiciones` trae `cam` directo: no hace falta pasar por
      -- `gps_equipos`. (Mi primera versión unía por `equipo_id`, que no existe:
      -- la columna es `id_equipo` y además sobra.)
      from gps_posiciones p
     where p.cam = v_cam
       and (p.ts at time zone 'America/Caracas')::date = v_fecha
       and p.lat is not null and p.lon is not null;

    select a.parroquia, a.zona into v_parroquia, v_zona
      from zona_asignacion a
     where a.cam = v_cam
       and a.desde <= v_fecha
       and (a.hasta is null or a.hasta >= v_fecha)
     limit 1;
  end if;

  insert into public.barrios_dichos
    (nombre, nombre_busca, declarado_por, telefono, dicho_en, cam, fecha,
     parroquia, zona, caja, posiciones, nota)
  values
    (trim(p_nombre), public.barrio_normaliza(p_nombre), v_quien, p_telefono, p_dicho_en,
     v_cam, v_fecha, v_parroquia, v_zona, v_caja, v_n, p_nota)
  on conflict (nombre_busca, telefono, fecha) do update
     set cam = coalesce(excluded.cam, barrios_dichos.cam),
         caja = coalesce(excluded.caja, barrios_dichos.caja),
         posiciones = coalesce(excluded.posiciones, barrios_dichos.posiciones),
         parroquia = coalesce(excluded.parroquia, barrios_dichos.parroquia),
         zona = coalesce(excluded.zona, barrios_dichos.zona),
         nota = coalesce(excluded.nota, barrios_dichos.nota)
  returning id into v_id;

  return v_id;
end $function$;

revoke all on function public.barrio_dicho_guardar(text, text, timestamptz, text, text) from public, anon;
grant execute on function public.barrio_dicho_guardar(text, text, timestamptz, text, text) to service_role;

-- ── Contestar una denuncia que viene con un NOMBRE ─────────────────────────
create or replace function public.barrio_a_zona(p_nombre text)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_busca text := public.barrio_normaliza(p_nombre);
  r record;
  v_out text;
  v_n integer := 0;
begin
  if coalesce(v_busca, '') = '' then
    return '⛔ No llegó ningún nombre de barrio.';
  end if;

  for r in
    select *, similarity(nombre_busca, v_busca) as parecido from barrios_dichos
     where nombre_busca = v_busca
        or nombre_busca like v_busca || '%'
        or v_busca like nombre_busca || '%'
        -- 0,45 salió de probar los casos REALES de este chofer: «nuevo
        -- orisonte»→«nuevo horizonte» y «reinaldo amya»→«reinaldo amaya».
        -- Más estricto los pierde; más flojo empieza a confundir barrios
        -- distintos que comparten una palabra.
        or similarity(nombre_busca, v_busca) > 0.45
     order by similarity(nombre_busca, v_busca) desc, fecha desc
     limit 6
  loop
    if v_n = 0 then
      v_out := format('📍 «%s» — lo que sabemos, y de dónde lo sabemos:', p_nombre);
    end if;
    v_n := v_n + 1;
    v_out := v_out || format(E'\n· %s lo nombró %s (%s)%s%s',
      to_char(r.fecha, 'DD/MM/YYYY'),
      coalesce(r.declarado_por, 'alguien del teléfono ' || coalesce(r.telefono, '?')),
      coalesce(r.cam, 'sin unidad'),
      case when r.parroquia is not null
           then format(', que ese día tenía %s zona %s', r.parroquia, coalesce(r.zona::text, '?'))
           else '' end,
      case when r.posiciones is not null
           then format(' · %s posiciones de GPS ese día', r.posiciones)
           else ' · ⚠️ sin GPS ese día' end);
  end loop;

  if v_n = 0 then
    return format('🔴 «%s» no está en el sistema.' ||
      E'\nNingún chofer ni nadie lo nombró todavía, y el callejero está por CALLES (Calle 74, Avenida 3E), no por barrios.' ||
      E'\n⇒ Para contestar esta denuncia hace falta una UBICACIÓN del punto, o preguntarle al chofer de esa ruta qué calles son.', p_nombre);
  end if;

  -- ⛔ Y SE DICE QUE ES UNA DECLARACIÓN, NO UN LÍMITE. Quien lea esto tiene que
  --    poder distinguir «el camión estuvo por acá» de «este es el barrio».
  v_out := v_out || E'\n\n⚠️ Esto es lo que una persona DECLARÓ, no el límite del barrio: el rectángulo guardado es por dónde anduvo el camión ese día. Para el minuto exacto de un punto, mandá la ubicación.';
  return v_out;
end $function$;

revoke all on function public.barrio_a_zona(text) from public, anon;
grant execute on function public.barrio_a_zona(text) to authenticated, service_role;

comment on function public.barrio_a_zona(text) is
  'De un NOMBRE de barrio o sector dicho por alguien (una denuncia del IMAU, un chofer): quién lo nombró, cuándo, con qué camión y qué zona tenía ese día. ⛔ Es una declaración con su evidencia, NO el límite del barrio: el callejero del sistema está por calles numeradas. Si el nombre no está, lo dice y pide la ubicación.';

commit;
