-- ============================================================================
-- MaxRecuerda — ADAPTADOR PARA BETANGAR  (base hrkjddehqnzcqwlkklqm)
--
-- Sirve igual, sin tocar una coma, para FLOTILLA, VIDECA y FlotaMax-DEMO: las
-- cuatro comparten `empleados`, `btg_usuarios`, `cola_mensajes` y `app_rol()`.
--
-- ⚠️ Este Supabase aloja TAMBIÉN Geppetto (tablas `edu_*` / `usdt_*`). Nada de
--    lo de aquí las toca.
--
-- Correr DESPUÉS de `01_nucleo.sql`. Idempotente.
-- ============================================================================

-- ── 1) La zona ──────────────────────────────────────────────────────────────
-- Betangar guarda la configuración como filas clave/valor. Si algún día se
-- añade `zona_horaria`, esto la toma sola; mientras tanto, Caracas.
create or replace function public.rec_zona() returns text
language sql stable set search_path to 'public', 'pg_temp' as $$
  select coalesce(
    nullif((select c.valor from public.configuracion c where c.clave = 'zona_horaria' limit 1), ''),
    'America/Caracas');
$$;

-- ── 2) Un solo negocio por base ─────────────────────────────────────────────
-- Cada empresa del grupo tiene SU base. No hay tenant que separar aquí, y
-- fingir que lo hay sería inventar una columna que nadie mantiene.
create or replace function public.rec_tenant_actual() returns text
language sql stable set search_path to 'public', 'pg_temp' as $$
  select null::text;
$$;

-- ── 3) Quién programa y quién borra ─────────────────────────────────────────
-- Se apoya en `app_rol()`, que ya existe y ya es SECURITY DEFINER.
-- `operador` y `rrhh` entran a propósito: la secretaria tiene que poder
-- agendarle un recordatorio al jefe — que es justo el caso que originó esto.
-- `visualizador`, `directivo` y los `demo_*` NO: ver no es programar.
create or replace function public.rec_es_staff() returns boolean
language sql stable set search_path to 'public', 'pg_temp' as $$
  select public.app_rol() = any (array['superadmin','admin','operador','rrhh']);
$$;

create or replace function public.rec_puede_borrar() returns boolean
language sql stable set search_path to 'public', 'pg_temp' as $$
  select public.app_puede_borrar();
$$;

-- ── 4) Quién soy ────────────────────────────────────────────────────────────
-- ⚠️ El puente es `btg_usuarios.usuario` → `empleados`. En Betangar el usuario
-- de login NO trae el id del empleado, así que se cruza por NOMBRE, y eso es
-- exactamente lo que salió mal con el roster: un nombre corto puede apuntar a
-- dos personas. Por eso:
--   · se exige coincidencia EXACTA del nombre completo, normalizado;
--   · si hay DOS candidatos, no se elige ninguno — se devuelve sin persona.
-- Un recordatorio que le llega a la persona equivocada es peor que uno que no
-- llega: el que no llega se nota.
create or replace function public.rec_norm_nombre(p text) returns text
language sql immutable set search_path to 'public', 'pg_temp' as $$
  select btrim(regexp_replace(
           upper(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')),
           '\s+', ' ', 'g'));
$$;

create or replace function public.rec_quien_soy()
returns table (persona_id text, nombre text, telefono text)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare u record; n int;
begin
  select bu.nombre, bu.wa into u
    from public.btg_usuarios bu
   where bu.auth_user_id = auth.uid() and coalesce(bu.activo, true)
   limit 1;
  if not found then return; end if;

  select count(*) into n from public.empleados e
   where public.rec_norm_nombre(e.nombre) = public.rec_norm_nombre(u.nombre)
     and coalesce(e.activo, true);

  if n = 1 then
    return query
      select e.id::text, e.nombre,
             coalesce(nullif(e.whatsapp, ''), e.tel, u.wa)
        from public.empleados e
       where public.rec_norm_nombre(e.nombre) = public.rec_norm_nombre(u.nombre)
         and coalesce(e.activo, true);
  else
    -- ⛔ Cero candidatos (el dueño no está en nómina) o DOS (dos homónimos):
    -- el sistema NO elige. Se identifica por el usuario, y así al menos la
    -- campanita queda vacía en vez de enseñar los pendientes de otro.
    return query select null::text, u.nombre, u.wa;
  end if;
end;
$$;

-- ── 5) El directorio ────────────────────────────────────────────────────────
-- ⚠️ `security_invoker = true`: sin esto la vista correría como `postgres` y se
-- saltaría la RLS de `empleados`. Es la falla que el 06/08 dejó la cartera de
-- clientes de Maxware devolviendo 200 a la anon key.
drop view if exists public.rec_directorio;
create view public.rec_directorio with (security_invoker = true) as
  select e.id::text                                   as persona_id,
         e.nombre                                     as nombre,
         coalesce(nullif(e.whatsapp, ''), e.tel)      as telefono,
         coalesce(e.cargo, '')                        as rol,
         null::text                                   as tenant,
         true                                         as activo
    from public.empleados e
   where coalesce(e.activo, true)
     and coalesce(nullif(e.whatsapp, ''), e.tel, '') <> '';

grant select on public.rec_directorio to authenticated;

comment on view public.rec_directorio is
  'MaxRecuerda: las personas a las que se les puede programar un recordatorio. '
  'Un empleado dado de baja sale solo — sin esto se le seguiría escribiendo.';

-- ── 6) La boca: la cola que Betangar YA tiene ───────────────────────────────
-- `cola_mensajes` la vacía el cron `betangar-wassenger-worker` cada 3 minutos,
-- con el número del negocio y con la lista blanca puesta el 02/08.
-- ⛔ MaxRecuerda no abre un segundo camino: usa ese.
--
-- ⚠️ `tipo = 'maxrecuerda'`, NO 'recordatorio'. Comprobado en la base: el tipo
-- 'recordatorio' YA lo usa el sistema viejo de avisos por rol (el cron
-- `recordatorios-cron`, cada hora). Reusarlo dejaría los dos mezclados y
-- «cuántos avisos salieron por este módulo» pasaría de ser una consulta a ser
-- una adivinanza.
--
-- `ref` guarda el id de la entrega: así, desde una fila de la cola se llega al
-- recordatorio que la originó sin tener que cotejar por el texto.
--
-- ⚠️ El worker CADUCA a las 12 h lo que siga pendiente, y antepone él mismo la
-- etiqueta de la empresa. Por eso `rec_config.marca` va vacía (si no, la marca
-- saldría dos veces) y por eso `vence_min` del módulo debe quedar por DEBAJO de
-- esas 12 h — si no, el módulo daría por vivo un aviso que la cola ya tiró.
create or replace function public.rec_entregar(p_telefono text, p_mensaje text, p_ctx jsonb)
returns text
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare nuevo_id text;
begin
  insert into public.cola_mensajes (telefono, mensaje, tipo, ref)
  values (p_telefono, p_mensaje, 'maxrecuerda', p_ctx->>'ref')
  returning id::text into nuevo_id;
  return nuevo_id;
exception when others then
  return null;
end;
$$;

revoke all on function public.rec_entregar(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rec_entregar(text, text, jsonb) to service_role;

-- ── 7) Sembrar la ficha ─────────────────────────────────────────────────────
-- `marca` va VACÍA: el worker de Betangar ya antepone "♻️ Betangar:". Ponerla
-- también aquí sacaría la marca dos veces en cada mensaje.
update public.rec_config
   set marca = '',
       enlace_base = 'https://betangar.com/recordar.html',
       actualizado_at = now()
 where id = 1;

-- ── 8) COMPROBAR ────────────────────────────────────────────────────────────
-- select * from public.rec_diagnostico();
-- select * from public.rec_directorio order by nombre;   -- ¿sale la gente real?

-- ── ⛔ LO ÚLTIMO, SIEMPRE: cerrarle la puerta a `anon` ───────────────────────
-- Recrear `rec_directorio` arriba se la vuelve a REGALAR a `anon` (los default
-- privileges de estas bases le dan todo lo nuevo de `public`), y la anon key va
-- publicada en el bundle del navegador. Sin esta línea, el nombre y el teléfono
-- de toda la nómina quedan a un `curl` de distancia.
-- No es opcional y va al FINAL: cualquier `create view` posterior lo deshace.
select public.rec_cerrar_anon();
