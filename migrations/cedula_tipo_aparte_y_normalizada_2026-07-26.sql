-- ════════════════════════════════════════════════════════════════════════════
-- Maxware-Principal (Betangar + EduControl + MaxPersonal) — hrkjddehqnzcqwlkklqm
-- LA CÉDULA SE NORMALIZA: el tipo va aparte y el número es la identidad
--
-- NORMA de Máximo (2026-07-26): el tipo de identificación (V/E/J/G/P) va en un
-- selector aparte, nunca tecleado dentro del número — así el mismo cliente no
-- entra dos veces según cómo lo escriban.
--
-- POR QUÉ ACÁ, Y NO COMO PREVENCIÓN: en `empleados` ya pasó.
--   E836  ALEXANDER ARTURO PAZ GONZALEZ  →  'V-30340377'   (cargado 11-jun)
--   E342  CARLOS ALFREDO MONTIEL         →  '30340377'     (cargado 11-jul)
-- Dos personas DISTINTAS, las dos ACTIVAS, el mismo número. Como los textos son
-- distintos, nada chocó y entró en silencio. Con la cédula normalizada, el
-- 11-jul habría reventado al cargar a Carlos y alguien lo habría visto.
-- (Verificado: la colisión NO llegó a nómina ni a pagos BNC. Se agarró a tiempo.)
--
-- Formatos que había en `empleados`: 61 como 'V-12345678', 2 solo dígitos, 15
-- vacías (13 inactivos + ARIANNY MORAN y ANA FUENMAYOR, activas).
--
-- Esta migración NO reescribe la columna `cedula` que se muestra en la app: la
-- identidad pasa a ser una columna GENERADA (`cedula_canon`). Cambiar 78 valores
-- de display arriesgaría carnets y exportes que no puedo ver desde acá.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Forma canónica: TIPO + DÍGITOS ─────────────────────────────────────────
-- 'V-30.340.377', 'v30340377' y '30340377' son todos 'V30340377'.
-- El tipo ENTRA en la clave: un V-12345678 y un E-12345678 son personas
-- distintas, así que normalizar a solo-dígitos fusionaría gente real.
create or replace function public.cedula_norm(p_cedula text)
returns text language sql immutable as $$
  with limpio as (
    select upper(regexp_replace(coalesce(p_cedula, ''), '[^A-Za-z0-9]', '', 'g')) as v
  )
  select case
    when v ~ '^[VEJGP][0-9]+$' then v
    when v ~ '^[0-9]+$' then 'V' || v   -- sin letra se asume venezolano
    else v
  end
  from limpio;
$$;

-- Para mostrar: 'V30340377' → 'V-30.340.377'
create or replace function public.cedula_fmt(p_cedula text)
returns text language sql immutable as $$
  select case
    when public.cedula_norm(p_cedula) ~ '^[VEJGP][0-9]+$'
      then substring(public.cedula_norm(p_cedula) from 1 for 1) || '-' ||
           reverse(regexp_replace(reverse(substring(public.cedula_norm(p_cedula) from 2)), '(\d{3})(?=\d)', '\1.', 'g'))
    else public.cedula_norm(p_cedula)
  end;
$$;


-- ── El tipo, como dato aparte + la identidad, como columna generada ────────
alter table empleados          add column if not exists cedula_tipo text;
alter table edu_personas       add column if not exists cedula_tipo text;
alter table edu_representantes add column if not exists cedula_tipo text;
alter table edu_usuarios       add column if not exists cedula_tipo text;
alter table mp_empleados       add column if not exists cedula_tipo text;

update empleados          set cedula_tipo = substring(public.cedula_norm(cedula) from 1 for 1) where cedula_tipo is null and coalesce(cedula,'') <> '';
update edu_personas       set cedula_tipo = substring(public.cedula_norm(cedula) from 1 for 1) where cedula_tipo is null and coalesce(cedula,'') <> '';
update edu_representantes set cedula_tipo = substring(public.cedula_norm(cedula) from 1 for 1) where cedula_tipo is null and coalesce(cedula,'') <> '';
update edu_usuarios       set cedula_tipo = substring(public.cedula_norm(cedula) from 1 for 1) where cedula_tipo is null and coalesce(cedula,'') <> '';
update mp_empleados       set cedula_tipo = substring(public.cedula_norm(cedula) from 1 for 1) where cedula_tipo is null and coalesce(cedula,'') <> '';

-- `cedula_canon` es la IDENTIDAD. Generada: no se puede desincronizar de `cedula`.
alter table empleados          add column if not exists cedula_canon text generated always as (public.cedula_norm(cedula)) stored;
alter table edu_personas       add column if not exists cedula_canon text generated always as (public.cedula_norm(cedula)) stored;
alter table edu_representantes add column if not exists cedula_canon text generated always as (public.cedula_norm(cedula)) stored;
alter table edu_usuarios       add column if not exists cedula_canon text generated always as (public.cedula_norm(cedula)) stored;
alter table mp_empleados       add column if not exists cedula_canon text generated always as (public.cedula_norm(cedula)) stored;

comment on column empleados.cedula_canon is
  'IDENTIDAD normalizada (V30340377). Generada desde `cedula`: buscar y deduplicar por ACÁ, no por el texto que se tecleó.';


-- ── El candado: no puede haber dos con la misma cédula ─────────────────────
-- Parcial: las vacías no compiten entre sí. Si hay colisiones, el índice NO se
-- crea y la migración avisa CUÁLES son, en vez de fallar sin explicar.
do $$
declare r record; conflictos text := '';
begin
  for r in
    select cedula_canon, string_agg(id || ' ' || nombre, ' | ') as quienes
    from empleados where coalesce(cedula_canon,'') <> ''
    group by cedula_canon having count(*) > 1
  loop
    conflictos := conflictos || r.cedula_canon || ' → ' || r.quienes || E'\n';
  end loop;

  if conflictos <> '' then
    raise warning E'⛔ NO se creó el índice único de empleados: hay cédulas repetidas.\n%\nCorregí la cédula equivocada y volvé a correr el CREATE UNIQUE INDEX de abajo.', conflictos;
  else
    create unique index if not exists idx_empleados_cedula_unica
      on empleados (cedula_canon) where coalesce(cedula_canon,'') <> '';
  end if;
end $$;

-- Estas no tenían colisiones al 26-07 (73 registros revisados).
-- ⚠️ POR TENANT en las de EduControl: son multi-tenant y el diseño original ya
-- permitía a la misma persona en dos colegios (la constraint vieja era por
-- tenant). Un índice único GLOBAL habría pasado hoy —hay un solo colegio con
-- datos— y habría reventado con el segundo.
create unique index if not exists idx_edu_personas_cedula_unica
  on edu_personas (tenant_id, cedula_canon) where coalesce(cedula_canon,'') <> '';
create unique index if not exists idx_edu_representantes_cedula_unica
  on edu_representantes (tenant_id, cedula_canon) where coalesce(cedula_canon,'') <> '';
-- empleados (Betangar) y mp_empleados NO son multi-tenant: global es lo correcto.
create unique index if not exists idx_mp_empleados_cedula_unica
  on mp_empleados (cedula_canon) where coalesce(cedula_canon,'') <> '';

-- Índices de BÚSQUEDA: lo que la app usa para encontrar a alguien.
create index if not exists idx_empleados_cedula_canon on empleados (cedula_canon);
create index if not exists idx_edu_usuarios_cedula_canon on edu_usuarios (cedula_canon);
