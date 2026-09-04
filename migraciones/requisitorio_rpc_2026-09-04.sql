-- ════════════════════════════════════════════════════════════════════════════
-- EL CAMINO DEL REQUISITORIO — las funciones que mueven el pedido
-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-04. Van en la BASE y no en el navegador por tres motivos:
--   1. Quien firma entra por un enlace SIN sesión: el navegador no puede ser el
--      que decida si esa firma vale.
--   2. El estado no lo puede mover cualquiera desde la consola del navegador.
--   3. La decisión tiene que ser IDEMPOTENTE: reusar el enlace no puede aprobar
--      dos veces ni emitir dos órdenes. Es el mismo criterio de
--      `mant_solicitud_decidir()`, que ya rueda en Flotilla.
--
-- El camino: pedir → tomar → cotizar (y pedir firma) → decidir → recibir.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. PEDIR ────────────────────────────────────────────────────────────────
-- Lo llama el mecánico, el supervisor o quien sea desde la pantalla. Devuelve el
-- código para mostrarlo en el acto: sin número visible, la persona no sabe si
-- quedó.
create or replace function public.req_crear(
  p_datos jsonb, p_lineas jsonb
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r text := app_rol();
  quien text; rid text; ln jsonb; i int := 0; cod text; num int;
begin
  if r is null then raise exception 'Sin sesión'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Escriba al menos un renglón: qué hace falta y cuánto';
  end if;

  select coalesce(nombre, email) into quien from btg_usuarios where auth_user_id = auth.uid();
  rid := 'RQ' || (extract(epoch from clock_timestamp())*1000)::bigint;

  insert into requisiciones (
    id, origen, origen_ref, destino, cam, area, urgencia, consecuencia,
    solicitante, solicitante_rol, estado, monto_estimado_usd, nota
  ) values (
    rid,
    coalesce(p_datos->>'origen','suelto'),
    p_datos->>'origen_ref',
    coalesce(p_datos->>'destino','unidad'),
    p_datos->>'cam',
    p_datos->>'area',
    coalesce(p_datos->>'urgencia','cuando_se_pueda'),
    p_datos->>'consecuencia',
    coalesce(quien,'(desconocido)'), r,
    'enviada',
    nullif(p_datos->>'monto_estimado_usd','')::numeric,
    p_datos->>'nota'
  );

  for ln in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    insert into req_lineas (id, req_id, orden, item, cantidad, unidad, especificacion,
                            inv_id, desde_almacen, item_id, categoria)
    values (rid || '_' || i, rid, i,
            ln->>'item',
            coalesce(nullif(ln->>'cantidad','')::numeric, 1),
            coalesce(nullif(ln->>'unidad',''), 'pieza'),
            ln->>'especificacion',
            ln->>'inv_id',
            coalesce((ln->>'desde_almacen')::boolean, false),
            ln->>'item_id',
            ln->>'categoria');
  end loop;

  -- Si nació de una falla del checklist, la falla queda enlazada: es lo que
  -- permite cerrarla sola cuando esto termine, en vez de a mano.
  -- ⛔ `anomalias.id` es UUID y `origen_ref` es texto: se compara por TEXTO, no
  --    con un cast que revienta si el valor no es un uuid. La primera versión
  --    comparaba uuid = text dentro de un `exception when others then null`, así
  --    que fallaba SIEMPRE y EN SILENCIO — el pedido quedaba sin su falla
  --    enlazada y nadie se enteraba. Salió al probar el camino, no al leerlo.
  --    [[norma-la-pieza-dice-lo-que-no-hace]]
  if coalesce(p_datos->>'origen','') = 'anomalia' and coalesce(p_datos->>'origen_ref','') <> '' then
    update anomalias set req_id = rid
     where id::text = p_datos->>'origen_ref' and estado = 'abierta';
  end if;

  select codigo, numero into cod, num from requisiciones where id = rid;
  return json_build_object('ok', true, 'id', rid, 'codigo', cod, 'numero', num, 'renglones', i);
end $$;

-- ── 2. TOMAR — el acuse de recibo ───────────────────────────────────────────
-- ⛔ Sin este paso, «yo no lo vi» es una respuesta válida y nadie puede medir
--    cuánto tardó el pedido en ser mirado. El requisitorio cruza del taller al
--    área administrativa, y las cosas se pierden justo en esa frontera.
create or replace function public.req_tomar(p_id text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare r text := app_rol(); quien text; est text;
begin
  if r is null then raise exception 'Sin sesión'; end if;
  select coalesce(nombre, email) into quien from btg_usuarios where auth_user_id = auth.uid();
  select estado into est from requisiciones where id = p_id;
  if est is null then raise exception 'Ese requisitorio ya no existe'; end if;
  if est <> 'enviada' then
    return json_build_object('ok', false, 'error', 'Ya no está esperando: está en «'||est||'»');
  end if;
  update requisiciones
     set estado = 'tomada', tomada_at = now(), tomada_por = coalesce(quien,'(desconocido)')
   where id = p_id and estado = 'enviada';
  return json_build_object('ok', true, 'tomada_por', quien);
end $$;

-- ── 3. COTIZAR Y PEDIR LA FIRMA ─────────────────────────────────────────────
-- Compras carga las ofertas y marca la que recomienda. Acá se resuelve QUIÉN
-- tiene que firmar —con el monto ya en la mano— y sale el aviso.
create or replace function public.req_cotizar(
  p_id text, p_cotizaciones jsonb, p_recomendada text, p_motivo text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r text := app_rol(); quien text; c jsonb; i int := 0; monto numeric;
  cat text; dest text; ap json; tok text; tel text; url_base text;
  cod text; cam_ text; msg text; motivo_aviso text := null; n_cot int;
begin
  if r is null then raise exception 'Sin sesión'; end if;
  select coalesce(nombre, email) into quien from btg_usuarios where auth_user_id = auth.uid();
  select codigo, cam into cod, cam_ from requisiciones where id = p_id;
  if cod is null and not exists (select 1 from requisiciones where id = p_id) then
    raise exception 'Ese requisitorio ya no existe';
  end if;

  -- Las ofertas se reemplazan enteras: cotizar de nuevo es empezar de nuevo, no
  -- acumular ofertas viejas que ya nadie mira.
  delete from req_cotizaciones where req_id = p_id;
  for c in select * from jsonb_array_elements(coalesce(p_cotizaciones,'[]'::jsonb)) loop
    i := i + 1;
    insert into req_cotizaciones (id, req_id, proveedor_id, proveedor, monto_usd,
                                  dias_entrega, nota, recomendada, motivo_eleccion, cargada_por)
    values (p_id || '_C' || i, p_id, c->>'proveedor_id', coalesce(c->>'proveedor','(sin nombre)'),
            coalesce(nullif(c->>'monto_usd','')::numeric, 0),
            nullif(c->>'dias_entrega','')::int, c->>'nota',
            coalesce(c->>'clave', '') = coalesce(p_recomendada,''),
            case when coalesce(c->>'clave','') = coalesce(p_recomendada,'') then p_motivo else null end,
            coalesce(quien,'(desconocido)'));
  end loop;

  select count(*), min(monto_usd) into n_cot, monto from req_cotizaciones where req_id = p_id;
  -- El monto que decide quién firma es el de la oferta RECOMENDADA, no el más
  -- barato: es el que se va a gastar de verdad si la aprueban.
  select monto_usd into monto from req_cotizaciones where req_id = p_id and recomendada limit 1;
  if monto is null then select max(monto_usd) into monto from req_cotizaciones where req_id = p_id; end if;

  select categoria into cat from req_lineas where req_id = p_id and categoria is not null limit 1;
  select destino into dest from requisiciones where id = p_id;
  ap := req_quien_aprueba(monto, cat, dest);

  tok := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  update requisiciones
     set estado = 'espera_firma', cotizada_at = now(), firma_pedida_at = now(),
         monto_estimado_usd = monto, token = tok,
         aprueba_rol = ap->>'rol', aprueba_usuario = ap->>'usuario', regla_aplicada = ap->>'regla'
   where id = p_id;

  -- El aviso a quien firma. Mismo camino que el resto: la cola, no un envío directo.
  select valor into url_base from configuracion where clave = 'app_url';
  url_base := btrim(coalesce(url_base,''));
  if right(url_base,1) = '/' then url_base := left(url_base, length(url_base)-1); end if;

  -- ⛔ El teléfono sale de la PERSONA que tiene que firmar, no de un número fijo.
  select u.wa into tel from btg_usuarios u
   where coalesce(u.activo, true)
     and ( (ap->>'usuario' is not null and u.usuario = ap->>'usuario')
        or (ap->>'usuario' is null and u.rol = ap->>'rol') )
     and coalesce(u.wa,'') <> ''
   limit 1;

  if coalesce(tel,'') = '' then
    motivo_aviso := 'No se avisó: quien tiene que firmar ('||coalesce(ap->>'usuario', ap->>'rol')||') no tiene WhatsApp cargado.';
  elsif url_base = '' then
    motivo_aviso := 'No se avisó: falta la dirección de la aplicación (app_url).';
  else
    msg := 'Le pedimos su autorización.' || chr(10) || chr(10) ||
           coalesce(cod,'') || coalesce(' · ' || nullif(cam_,''), '') || chr(10) ||
           'Monto: US$ ' || to_char(coalesce(monto,0),'FM999G999G990D00') ||
           case when n_cot > 1 then '  ·  ' || n_cot || ' ofertas comparadas' else '' end || chr(10) || chr(10) ||
           'Para verlo y decidir:' || chr(10) ||
           url_base || '/aprobar.html?r=' || tok || chr(10) || chr(10) ||
           'El enlace es personal, por favor no lo reenvíe.';
    insert into cola_mensajes (tipo, telefono, mensaje, ref)
    values ('aprobacion', tel, msg, 'req_' || left(tok,12));
  end if;

  if motivo_aviso is not null then
    update requisiciones set nota = coalesce(nota||' · ','') || motivo_aviso where id = p_id;
  end if;

  return json_build_object('ok', true, 'ofertas', i, 'monto', monto,
                           'firma', coalesce(ap->>'usuario', ap->>'rol'),
                           'aviso', motivo_aviso is null, 'motivo', motivo_aviso);
end $$;

-- ── 4. VER PARA FIRMAR — sin sesión, protegido por el token ─────────────────
create or replace function public.req_ver(p_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare q record; lineas json; ofertas json;
begin
  select * into q from requisiciones where token = p_token;
  if q.id is null then return json_build_object('ok', false, 'error', 'Enlace no válido o vencido'); end if;

  select coalesce(json_agg(json_build_object('item', item, 'cantidad', cantidad, 'unidad', unidad,
                                             'especificacion', especificacion, 'desde_almacen', desde_almacen)
                           order by orden), '[]'::json)
    into lineas from req_lineas where req_id = q.id;

  select coalesce(json_agg(json_build_object('id', id, 'proveedor', proveedor, 'monto_usd', monto_usd,
                                             'dias_entrega', dias_entrega, 'nota', nota,
                                             'recomendada', recomendada, 'motivo', motivo_eleccion)
                           order by monto_usd), '[]'::json)
    into ofertas from req_cotizaciones where req_id = q.id;

  return json_build_object('ok', true, 'codigo', q.codigo, 'estado', q.estado,
    'cam', q.cam, 'area', q.area, 'destino', q.destino, 'urgencia', q.urgencia,
    'consecuencia', q.consecuencia, 'solicitante', q.solicitante, 'fecha', q.fecha,
    'monto', q.monto_estimado_usd, 'lineas', lineas, 'ofertas', ofertas,
    'decidida_at', q.decidida_at, 'decidida_por', q.decidida_por, 'decision_nota', q.decision_nota);
end $$;

-- ── 5. DECIDIR — y de acá NACE la orden ─────────────────────────────────────
-- ⛔ IDEMPOTENTE: reusar el enlace no aprueba dos veces ni emite dos órdenes.
--    Es el candado que ya se aprendió en `ordenes_servicio` (dos órdenes iguales
--    con 7 segundos entre una y otra) y en `mant_solicitud_decidir()`.
create or replace function public.req_decidir(
  p_token text, p_decision text, p_cotizacion_id text, p_quien text, p_nota text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
-- ⚠️ `ordenes_servicio.cams` es JSONB, no text[]. La app siempre lo escribió
--    desde JavaScript, así que nunca hizo falta saberlo; desde SQL sí. Salió al
--    recorrer el camino, no al leer el código.
declare q record; ofe record; oid text; cams_ jsonb;
begin
  if p_decision not in ('aprobar','rechazar','devolver') then
    raise exception 'Decisión no reconocida';
  end if;
  select * into q from requisiciones where token = p_token;
  if q.id is null then return json_build_object('ok', false, 'error', 'Enlace no válido o vencido'); end if;

  -- Ya decidido: se contesta lo mismo, no se vuelve a aplicar.
  if q.decidida_at is not null then
    return json_build_object('ok', true, 'repetido', true, 'estado', q.estado,
      'orden_id', q.orden_id, 'decidida_por', q.decidida_por,
      'mensaje', 'Este requisitorio ya se decidió el ' || to_char(q.decidida_at,'DD/MM/YYYY HH24:MI'));
  end if;

  if p_decision = 'rechazar' then
    update requisiciones set estado='rechazada', decidida_at=now(),
           decidida_por=coalesce(p_quien,'(sin nombre)'), decision_nota=p_nota where id=q.id;
    return json_build_object('ok', true, 'estado', 'rechazada');
  end if;

  if p_decision = 'devolver' then
    -- ⛔ Devolver NO es rechazar: vuelve a compras y el pedido sigue vivo. Si
    --    fuera un rechazo, habría que hacer el requisitorio de nuevo.
    update requisiciones set estado='tomada', decision_nota=p_nota,
           token=null, firma_pedida_at=null where id=q.id;
    return json_build_object('ok', true, 'estado', 'tomada', 'devuelto', true);
  end if;

  -- APROBAR: si eligió una oferta distinta a la recomendada, manda la suya.
  if coalesce(p_cotizacion_id,'') <> '' then
    select * into ofe from req_cotizaciones where id = p_cotizacion_id and req_id = q.id;
  else
    select * into ofe from req_cotizaciones where req_id = q.id and recomendada limit 1;
  end if;
  if ofe.id is null then
    select * into ofe from req_cotizaciones where req_id = q.id order by monto_usd limit 1;
  end if;

  update req_cotizaciones set elegida = (id = ofe.id) where req_id = q.id;

  -- LA ORDEN NACE ACÁ, no la escribe nadie a mano.
  oid := 'OS' || (extract(epoch from clock_timestamp())*1000)::bigint;
  cams_ := case
             when q.destino = 'unidad'     and coalesce(q.cam,'') <> '' then to_jsonb(array[q.cam])
             when q.destino = 'patio'      then to_jsonb(array['PATIO'])
             when q.destino = 'inventario' then to_jsonb(array['INVENTARIO'])
             else to_jsonb(array[coalesce(q.area,'GENERAL')])
           end;

  insert into ordenes_servicio (id, fecha, cams, proveedor, proveedor_id, tipo_servicio,
                                tipo_orden, item, notas, estado, req_id)
  values (oid, (now() at time zone 'America/Caracas')::date, cams_,
          coalesce(ofe.proveedor,''), ofe.proveedor_id, 'otro',
          case when q.destino = 'unidad' then 'servicio' else 'compra' end,
          (select string_agg(item || ' x' || trim(to_char(cantidad,'FM999999990.###')), ' · ' order by orden)
             from req_lineas where req_id = q.id and not desde_almacen),
          'Nace del requisitorio ' || q.codigo ||
            case when coalesce(p_nota,'') <> '' then ' · ' || p_nota else '' end,
          'emitida', q.id);

  update requisiciones
     set estado='aprobada', decidida_at=now(), decidida_por=coalesce(p_quien,'(sin nombre)'),
         decision_nota=p_nota, monto_aprobado_usd=ofe.monto_usd, orden_id=oid,
         atendida_at=now()
   where id = q.id;

  return json_build_object('ok', true, 'estado','aprobada', 'orden_id', oid,
                           'proveedor', ofe.proveedor, 'monto', ofe.monto_usd);
end $$;

-- ── 6. RECIBIR — y la falla se cierra SOLA ──────────────────────────────────
-- ⛔ La conformidad la da QUIEN PIDIÓ, no quien compró. Cuatro pasos del circuito
--    caen en el área administrativa (cotizar, comprar, facturar, pagar); el
--    control que queda es que el que va a usar la pieza diga que llegó y sirve.
create or replace function public.req_recibir(p_id text, p_conforme boolean, p_nota text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare r text := app_rol(); quien text; q record; cerrada int := 0;
begin
  if r is null then raise exception 'Sin sesión'; end if;
  select coalesce(nombre, email) into quien from btg_usuarios where auth_user_id = auth.uid();
  select * into q from requisiciones where id = p_id;
  if q.id is null then raise exception 'Ese requisitorio ya no existe'; end if;
  if q.estado not in ('aprobada','atendida') then
    return json_build_object('ok', false, 'error', 'Todavía no está aprobado: está en «'||q.estado||'»');
  end if;

  if not p_conforme then
    update requisiciones set nota = coalesce(nota||' · ','') ||
           'Recibido NO conforme por ' || coalesce(quien,'?') || ': ' || coalesce(p_nota,'')
     where id = p_id;
    return json_build_object('ok', true, 'conforme', false,
      'mensaje', 'Queda anotado que no llegó conforme. La orden sigue abierta.');
  end if;

  update requisiciones
     set estado='recibida', recibida_at=now(), recibida_por=coalesce(quien,'(desconocido)'),
         nota = case when coalesce(p_nota,'')<>'' then coalesce(nota||' · ','')||p_nota else nota end
   where id = p_id;

  -- La falla que originó todo esto se cierra SOLA. Antes se cerraba a mano con
  -- un texto libre, sin enlace a nada: «resuelta» era una afirmación sin
  -- evidencia, y es la palabra sobre la que descansa que un camión salga.
  if q.origen = 'anomalia' and coalesce(q.origen_ref,'') <> '' then
    update anomalias
       set estado='resuelta', resuelta_por=coalesce(quien,'(sistema)'), resuelta_at=now(),
           nota_resolucion = 'Cerrada por el requisitorio ' || coalesce(q.codigo,q.id) ||
                             coalesce(' · orden ' || q.orden_id, '')
     where id::text = q.origen_ref and estado='abierta';
    get diagnostics cerrada = row_count;
  end if;

  return json_build_object('ok', true, 'conforme', true, 'anomalias_cerradas', cerrada);
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.req_crear(jsonb, jsonb)                       from anon, authenticated;
revoke all on function public.req_tomar(text)                               from anon, authenticated;
revoke all on function public.req_cotizar(text, jsonb, text, text)          from anon, authenticated;
revoke all on function public.req_ver(text)                                 from anon, authenticated;
revoke all on function public.req_decidir(text, text, text, text, text)     from anon, authenticated;
revoke all on function public.req_recibir(text, boolean, text)              from anon, authenticated;

grant execute on function public.req_crear(jsonb, jsonb)                    to authenticated;
grant execute on function public.req_tomar(text)                            to authenticated;
grant execute on function public.req_cotizar(text, jsonb, text, text)       to authenticated;
grant execute on function public.req_recibir(text, boolean, text)           to authenticated;

-- ⛔ Estas dos SÍ van a `anon`: quien firma entra por un enlace, sin sesión. Lo
--    que las protege es el token, que es de 64 caracteres y de un solo uso —
--    mismo criterio que `mant_solicitud_ver` / `_decidir`, que ya ruedan.
grant execute on function public.req_ver(text)                              to anon, authenticated;
grant execute on function public.req_decidir(text, text, text, text, text)  to anon, authenticated;
