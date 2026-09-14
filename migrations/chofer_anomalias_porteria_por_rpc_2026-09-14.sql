-- ════════════════════════════════════════════════════════════════════════════
-- EL CHOFER ENTRA SIN LOGIN: SUS ÚLTIMAS 3 TABLAS DIRECTAS PASAN A RPC
--
-- 🔴 POR QUÉ, 14/09/2026 — Y ES UNA REGRESIÓN QUE CAUSÉ YO HOY.
--    Hoy se le revocó a `anon` el acceso a `anomalias`, `porteria` y
--    `cola_mensajes`. Se hizo creyendo que `chofer.html` entraba CON login,
--    porque el archivo tiene `signInWithPassword`. **Tenerlo no es usarlo:**
--    `BTG_CHOFER_CONFIG.login = false` en los CINCO productos. El chofer entra
--    por QR y corre como `anon`.
--    ⇒ Desde el revoke, esas tres dan **401 permission denied** y el chofer no
--      puede reportar una falla ni una incidencia de portería. Medido con la
--      llave real sacada del propio `chofer.html`, no deducido del catálogo.
--    ⇒ Y NO eran tablas muertas: `anomalias` tiene 51 filas con `origen='chofer'`
--      y la última es **de hoy**; `porteria` 187, con 36 en los últimos 3 días.
--
-- ⛔ LO QUE NO SE HACE: devolverle el grant a `anon`. Eso reabre justo el agujero
--    que se cerró — las 51 anomalías traen `reportado_por` con nombre y apellido.
--
-- ✅ LO QUE SE HACE: lo mismo que el 15/08 con las 4 tablas del checklist y hoy
--    con `sitios_asistencia` — el chofer no toca tablas, llama RPC
--    `security definer`. La lógica que estaba en el navegador (deduplicar por
--    `item_norm`, no bajar `critico`, contar `veces`) se muda ACÁ, donde además
--    no se puede saltar: hasta hoy cualquiera con la llave pública podía escribir
--    una anomalía a nombre de otro chofer.
--
-- ⛔ Y EL AVISO DE KM SOSPECHOSO NO RECIBE DESTINATARIO. Hasta hoy el navegador
--    insertaba en `cola_mensajes` con el teléfono ESCRITO EN EL HTML: cualquiera
--    con la llave pública podía encolar un mensaje a cualquier número permitido,
--    con el texto que quisiera. Ahora el RPC recibe solo los datos del hecho
--    (unidad, chofer, km) y **arma el texto y elige el destino adentro**.
--    [[norma-el-proveedor-decide-el-destinatario]]
--
-- Idempotente. Reversa al final.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Las anomalías ABIERTAS de una unidad ─────────────────────────────────
create or replace function public.chofer_anomalias_dia(p_cam text)
returns setof public.anomalias
language sql security definer set search_path = public stable as $$
  select * from anomalias
   where cam = upper(trim(coalesce(p_cam,'')))
     and estado = 'abierta'
   order by critico desc, fecha_reporte asc;
$$;

-- ── 2. Abrir las fallas que el chofer marcó en MAL ──────────────────────────
-- `p_items`: [{item, item_norm, label, critico}, …]
-- El deduplicado por `item_norm` se hacía en el navegador con un SELECT previo;
-- acá va en el mismo statement, así que dos teléfonos a la vez no pueden colarse
-- entre el SELECT y el INSERT. El `on conflict do nothing` cubre el índice único
-- parcial (cam, item_norm) where abierta, que es lo que antes se ignoraba
-- mirando el código 23505 una fila a la vez.
create or replace function public.chofer_anomalias_abrir(
  p_cam text, p_items jsonb, p_obs text, p_quien text, p_fecha date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_cam text := upper(trim(coalesce(p_cam,'')));
  v_fecha date := coalesce(p_fecha, current_date);
  v_n integer := 0;
begin
  if v_cam = '' or p_items is null or jsonb_typeof(p_items) <> 'array' then return 0; end if;

  insert into anomalias (cam, item, item_norm, label, critico, detalle, origen,
                         reportado_por, fecha_reporte, visto_ultima_fecha, estado)
  select v_cam,
         i->>'item',
         i->>'item_norm',
         coalesce(i->>'label', i->>'item'),
         coalesce((i->>'critico')::boolean, false),
         coalesce(p_obs,''),
         'chofer',
         coalesce(p_quien,''),
         v_fecha, v_fecha, 'abierta'
    from jsonb_array_elements(p_items) i
   where coalesce(i->>'item_norm','') <> ''
     and not exists (select 1 from anomalias a
                      where a.cam = v_cam and a.item_norm = i->>'item_norm'
                        and a.estado = 'abierta')
  on conflict do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 3. La OBSERVACIÓN en texto del chofer ───────────────────────────────────
-- Una sola abierta por unidad. Si ya hay, se REFRESCA. `critico` solo SUBE: que
-- mañana escriba una nota menor no baja una falla que ayer mandó la unidad al
-- taller — eso lo cierra la oficina, no esta pantalla.
create or replace function public.chofer_anomalia_observacion(
  p_cam text, p_texto text, p_estado text, p_quien text, p_fecha date)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cam text := upper(trim(coalesce(p_cam,'')));
  v_fecha date := coalesce(p_fecha, current_date);
  v_obs text := trim(coalesce(p_texto,''));
  v_fuera boolean := coalesce(p_estado,'') <> '' and lower(p_estado) <> 'operativo';
  v_detalle text;
  v_id uuid;
  v_critico boolean;
  v_det_ya text;
begin
  if v_cam = '' then return 'sin_unidad'; end if;
  if v_obs = '' and not v_fuera then return 'nada_que_reportar'; end if;
  v_detalle := coalesce(nullif(v_obs,''), 'Reportada como ' || replace(coalesce(p_estado,''),'_',' '));

  select id, critico, detalle into v_id, v_critico, v_det_ya
    from anomalias
   where cam = v_cam and item_norm = 'observacion' and estado = 'abierta'
   limit 1;

  if v_id is not null then
    update anomalias
       set visto_ultima_fecha = v_fecha,
           veces = coalesce(veces,1) + 1,
           reportado_por = coalesce(p_quien,''),
           detalle = case when v_detalle <> coalesce(v_det_ya,'') then v_detalle else detalle end,
           critico = case when v_fuera then true else critico end
     where id = v_id;
    return 'refrescada';
  end if;

  insert into anomalias (cam, item, item_norm, label, critico, detalle, origen,
                         reportado_por, fecha_reporte, visto_ultima_fecha, veces, estado)
  values (v_cam, 'observacion', 'observacion', 'Observación del chofer', v_fuera,
          v_detalle, 'chofer', coalesce(p_quien,''), v_fecha, v_fecha, 1, 'abierta')
  on conflict do nothing;
  return 'abierta';
end $$;

-- ── 4. Incidencia de portería ───────────────────────────────────────────────
-- El `tipo` se fuerza a 'incidencia' acá: antes venía del navegador y con la
-- llave pública se podía escribir cualquier tipo en la tabla de portería.
-- ⛔ VA UN DROP ANTES, y no es adorno: `create or replace` NO puede cambiar el
--    tipo de retorno de una funcion que ya existe -- contesta «cannot change
--    return type of existing function» y el archivo entero se revierte. La
--    primera version de hoy devolvia bigint y alcanzo a crearse en Betangar.
drop function if exists public.chofer_porteria_incidencia(jsonb);
create or replace function public.chofer_porteria_incidencia(p_fila jsonb)
-- ⚠️ Devuelve TEXT, no el tipo del id. `anomalias.id` y `porteria.id` son UUID en
--    las seis bases (comprobado, no supuesto): declarar `bigint` reventaba con
--    «invalid input syntax for type bigint». Lo cazó la prueba en `rollback`
--    ANTES de desplegar. Text no se casa con el tipo de la tabla, que es
--    justo lo que hace falta en una pieza que se replica a seis bases.
returns text
language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if p_fila is null then return null; end if;
  insert into porteria (tipo, fecha, hora, nombre, subtipo, detalle, vigilante)
  values ('incidencia',
          nullif(p_fila->>'fecha','')::date,
          p_fila->>'hora',
          p_fila->>'nombre',
          coalesce(p_fila->>'subtipo',''),
          p_fila->>'detalle',
          p_fila->>'vigilante')
  returning id::text into v_id;
  return v_id;
end $$;

-- ── 5. El aviso de km sospechoso ────────────────────────────────────────────
-- ⛔ NO recibe teléfono ni texto: los arma adentro. Lo único que entra son los
--    datos del hecho. El destino sale de `configuracion` (clave `aviso_km_tel`)
--    y si no está, del número de la casa.
create or replace function public.chofer_aviso_km_sospechoso(
  p_cam text, p_chofer text, p_km numeric, p_ref numeric)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_tel text;
  v_msg text;
begin
  if coalesce(trim(p_cam),'') = '' or p_km is null or p_ref is null then return false; end if;
  select nullif(trim(valor),'') into v_tel from configuracion where clave = 'aviso_km_tel';
  v_tel := coalesce(v_tel, '584147379886');

  v_msg := '⚠️ *Km sospechoso confirmado* — Unidad ' || upper(trim(p_cam)) ||
           ' (' || coalesce(nullif(trim(p_chofer),''),'chofer') || ') guardó ' ||
           to_char(p_km,'FM999G999G999') || ' km viniendo de ' ||
           to_char(p_ref,'FM999G999G999') || ' (+' ||
           to_char(p_km - p_ref,'FM999G999G999') ||
           ' en un día). Revísalo y corrígelo en el sistema si es un error.';

  insert into cola_mensajes (telefono, mensaje, tipo, estado)
  values (v_tel, v_msg, 'supervision', 'pendiente');
  return true;
end $$;


-- ── 6. La incidencia MECANICA / ACCIDENTE tambien abre anomalia ─────────────
-- Existe desde el reporte de Tony Gas del 12/09 (punto g): una falla mecanica o un
-- accidente tiene que llegarle al mecanico y al checklist, que leen `anomalias`, no
-- `porteria`. Hoy solo la tiene el `chofer.html` de Tony Gas, pero el RPC va a las
-- SEIS bases: si manana se replica la pantalla, la pieza ya esta y no nace otro
-- clon escribiendo la tabla directo. [[norma-arreglo-en-una-es-arreglo-en-todas-misma-sesion]]
create or replace function public.chofer_anomalia_incidencia(
  p_cam text, p_tipo text, p_desc text, p_ubi text, p_quien text, p_fecha date)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_cam text := upper(trim(coalesce(p_cam,'')));
  v_fecha date := coalesce(p_fecha, current_date);
  v_tipo text := lower(trim(coalesce(p_tipo,'')));
  v_norm text;
  v_label text;
  v_detalle text;
  v_id uuid;
  v_det_ya text;
begin
  -- Los otros tipos (sin combustible, seguridad) quedan SOLO en el registro de
  -- incidencias: esa decision es de Tony Gas y se respeta aca, no en el navegador.
  if v_cam = '' or v_tipo not in ('mecanica','accidente') then return 'no_aplica'; end if;
  v_norm  := 'incidencia_' || v_tipo;
  v_label := case when v_tipo = 'mecanica'
                  then 'Falla mecánica reportada por el chofer'
                  else 'Accidente reportado por el chofer' end;
  v_detalle := trim(coalesce(p_desc,'')) ||
               case when coalesce(trim(p_ubi),'') <> '' then ' · Dónde: ' || trim(p_ubi) else '' end;

  select id, detalle into v_id, v_det_ya
    from anomalias
   where cam = v_cam and item_norm = v_norm and estado = 'abierta'
   limit 1;

  if v_id is not null then
    update anomalias
       set visto_ultima_fecha = v_fecha,
           veces = coalesce(veces,1) + 1,
           reportado_por = coalesce(p_quien,''),
           detalle = case when v_detalle <> coalesce(v_det_ya,'') then v_detalle else detalle end
     where id = v_id;
    return 'refrescada';
  end if;

  insert into anomalias (cam, item, item_norm, label, critico, detalle, origen,
                         reportado_por, fecha_reporte, visto_ultima_fecha, veces, estado)
  values (v_cam, v_norm, v_norm, v_label, true, v_detalle, 'incidencia',
          coalesce(p_quien,''), v_fecha, v_fecha, 1, 'abierta')
  on conflict do nothing;
  return 'abierta';
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────
-- ⛔ Toda función nace abierta a PUBLIC: el grant no cierra, hay que REVOCAR.
--    [[norma-toda-funcion-nace-abierta-a-public]]
revoke execute on function public.chofer_anomalias_dia(text)                         from public;
revoke execute on function public.chofer_anomalias_abrir(text,jsonb,text,text,date)  from public;
revoke execute on function public.chofer_anomalia_observacion(text,text,text,text,date) from public;
revoke execute on function public.chofer_porteria_incidencia(jsonb)                  from public;
revoke execute on function public.chofer_aviso_km_sospechoso(text,text,numeric,numeric) from public;
revoke execute on function public.chofer_anomalia_incidencia(text,text,text,text,text,date) from public;

grant execute on function public.chofer_anomalias_dia(text)                          to anon, authenticated;
grant execute on function public.chofer_anomalias_abrir(text,jsonb,text,text,date)   to anon, authenticated;
grant execute on function public.chofer_anomalia_observacion(text,text,text,text,date) to anon, authenticated;
grant execute on function public.chofer_porteria_incidencia(jsonb)                   to anon, authenticated;
grant execute on function public.chofer_aviso_km_sospechoso(text,text,numeric,numeric) to anon, authenticated;
grant execute on function public.chofer_anomalia_incidencia(text,text,text,text,text,date) to anon, authenticated;

-- ============================================================================
-- REVERSA: drop de las 5 funciones. ⛔ NO revertir devolviéndole el grant de las
-- tablas a `anon`: eso reabre la fuga de `anomalias` con nombres.
-- ============================================================================
