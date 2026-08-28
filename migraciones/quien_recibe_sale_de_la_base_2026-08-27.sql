-- ═══════════════════════════════════════════════════════════════════════════════
-- QUIÉN RECIBE UN AVISO SE PREGUNTA A LA BASE, NO SE LEE DEL CÓDIGO
--
-- ⛔ POR QUÉ. Máximo, 27/08: «que la lista de destinatarios no esté en el código
--    sino salga de la base». Al medirlo apareció que «quién recibe» vivía en SEIS
--    lugares a la vez:
--      1. `configuracion.whatsapp` — la lista buena, 7 personas.
--      2. el array `WA` clavado en app.js — 6 entradas, y la carga lo pisaba CAMPO
--         POR CAMPO Y POR POSICIÓN, así que el 7º (ANA FUENMAYOR, contadora) nunca
--         entró: no recibió un solo aviso desde que se la agregó, y no había forma
--         de notarlo porque nadie puede ver «a quién NO se le mandó».
--      3. `WA_DESTINOS` clavado en la función del banco — con dos socios que SOLO
--         existen ahí (Jonaz y Alejandro Castillo) y una baja anotada a mano.
--      4. `SUP_FALLBACK` clavado en km-anomalias, `MAXIMO`/`GLADYS` en auditoría.
--      5. `configuracion.avisos_checklist` — otra clave, otra lista.
--      6. `configuracion.viajes_semanal_tel` — un teléfono suelto.
--    Cada alta o baja obligaba a tocar el repo y desplegar, y las copias se
--    desincronizaban sin que nadie se enterara.
--
-- ⇒ La fuente única es `configuracion.whatsapp`, y esta función es la ÚNICA puerta:
--   cada aviso pide los ROLES que le corresponden y recibe quien esté hoy en ellos.
--   Agregar a alguien mañana es una fila, no un despliegue.
--
-- ⚠️ Devuelve NORMALIZADO y SIN REPETIDOS: dos roles pueden apuntar a la misma
--    persona (pasa cuando alguien cubre dos puestos) y no puede recibir el mensaje
--    dos veces.
-- ⚠️ Y NUNCA devuelve un número inválido: se exige que empiece por 58 y tenga 12
--    dígitos. Un número mal cargado no se «arregla» acá — se deja afuera y se
--    reporta, porque un dato imposible se rechaza, no se topa.
--    [[norma-valor-saneado-a-la-fuerza]]
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function public.destinatarios(p_roles text[])
returns table (telefono text, rol text, quien text)
language sql stable security definer set search_path = public as $$
  with lista as (
    select jsonb_array_elements(
             case when jsonb_typeof(c.valor::jsonb) = 'array' then c.valor::jsonb else '[]'::jsonb end
           ) as d
      from public.configuracion c
     where c.clave = 'whatsapp'
  ), limpio as (
    select regexp_replace(coalesce(d->>'num',''), '[^0-9]', '', 'g') as tel,
           d->>'rol'  as rol,
           d->>'desc' as quien,
           coalesce((d->>'activo')::boolean, true) as activo
      from lista
  )
  select distinct on (tel) tel, rol, quien
    from limpio
   where activo
     and rol = any(p_roles)
     and tel ~ '^58[0-9]{10}$'   -- ⛔ lo que no es un número venezolano completo no sale
   order by tel, rol;
$$;

grant execute on function public.destinatarios(text[]) to service_role;

-- ── LOS QUE HOY SOLO VIVEN EN EL CÓDIGO ─────────────────────────────────────
-- JONAZ y ALEJANDRO CASTILLO son socios del fondo y reciben CADA ingreso al banco.
-- ⚠️ Entran con rol propio `banco`, NO con `socios`: si entraran como socios les
--    empezaría a llegar todo lo demás que hoy reciben Máximo y Francisco, y eso
--    nadie lo pidió. El rol dice QUÉ recibe, no solo quién es.
do $$
declare v_wa jsonb; v_tiene int;
begin
  select valor::jsonb into v_wa from public.configuracion where clave = 'whatsapp';
  select count(*) into v_tiene from jsonb_array_elements(v_wa) e
   where regexp_replace(e->>'num','[^0-9]','','g') in ('584143501298','584145253105');
  if v_tiene = 0 then
    v_wa := v_wa
      || jsonb_build_object('num','584143501298','key','','rol','banco','desc','Socio del fondo — Jonaz','activo',true)
      || jsonb_build_object('num','584145253105','key','','rol','banco','desc','Socio del fondo — Alejandro Castillo','activo',true);
    update public.configuracion set valor = v_wa::text where clave = 'whatsapp';
    raise notice 'Sembrados Jonaz y Alejandro Castillo con rol banco';
  else
    raise notice 'Ya estaban en la base: no se toca';
  end if;
end $$;

-- ── CONTROL POSITIVO ────────────────────────────────────────────────────────
-- ⛔ Que la función compile no prueba nada. Lo que hay que probar es que quien
--    recibe HOY siga recibiendo: el riesgo de este cambio no es fallar, es dejar
--    a alguien callado sin que nadie lo note.
do $$
declare v_banco int; v_ana int; v_falla text;
begin
  -- 1. El aviso del banco: los 2 socios + los 2 del fondo = 4, los mismos de hoy.
  select count(*) into v_banco from public.destinatarios(array['socios','admin','banco']);
  if v_banco < 4 then
    raise exception 'el aviso del banco perdería gente: hoy le llega a 4 y la funcion devuelve %', v_banco;
  end if;
  -- 2. Ana Fuenmayor: la que nunca recibió nada. Si no aparece, esto no arregló nada.
  select count(*) into v_ana from public.destinatarios(array['contadora']);
  if v_ana <> 1 then
    raise exception 'ANA FUENMAYOR sigue sin aparecer (devolvio %): el arreglo no sirvio', v_ana;
  end if;
  -- 3. Un rol que no existe devuelve vacío, no todo. Un filtro que no filtra
  --    manda el mensaje a la empresa entera y eso se descubre tarde.
  select count(*)::text into v_falla from public.destinatarios(array['rol_que_no_existe']);
  if v_falla <> '0' then
    raise exception 'un rol inexistente devolvio % filas: el filtro no filtra', v_falla;
  end if;
  raise notice 'OK — banco: % destinatarios · contadora: % · rol inexistente: 0', v_banco, v_ana;
end $$;
