-- ════════════════════════════════════════════════════════════════════════════
-- AL QUE PIDIÓ SE LE AVISA — no se entera entrando a mirar
-- ════════════════════════════════════════════════════════════════════════════
-- 2026-09-04. El mecánico pide un repuesto porque la unidad está parada. Hasta
-- ahora, para saber si se lo aprobaron tenía que entrar al sistema y buscarlo.
-- Eso convierte una espera de horas en una espera de días: nadie revisa una
-- pantalla por si acaso.
--
-- ⛔ EL AVISO VA A LA PERSONA, NO A UN NÚMERO FIJO. Sale de `btg_usuarios.wa`
--    del usuario que pidió. Por eso hace falta guardar QUIÉN pidió, no solo su
--    nombre escrito: dos personas pueden llamarse parecido, y un nombre no tiene
--    teléfono.
--
-- ⛔ Y SI NO SE PUEDE AVISAR, QUEDA ESCRITO. La decisión NUNCA se pierde por no
--    poder mandar el mensaje: se aplica igual y el motivo va a la nota.
--    [[norma-respaldo-que-inventa-un-dato]]
--
-- El texto va DE USTED. [[norma-geppetto-whatsapp-de-usted]]
-- ════════════════════════════════════════════════════════════════════════════

alter table public.requisiciones add column if not exists solicitante_usuario text;

-- ── 1. Guardar QUIÉN pidió (no solo cómo se llama) ──────────────────────────
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
  quien text; quien_us text; rid text; ln jsonb; i int := 0; cod text; num int;
begin
  if r is null then raise exception 'Sin sesión'; end if;
  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Escriba al menos un renglón: qué hace falta y cuánto';
  end if;

  select coalesce(nombre, email), usuario into quien, quien_us
    from btg_usuarios where auth_user_id = auth.uid();
  rid := 'RQ' || (extract(epoch from clock_timestamp())*1000)::bigint;

  insert into requisiciones (
    id, origen, origen_ref, destino, cam, area, urgencia, consecuencia,
    solicitante, solicitante_usuario, solicitante_rol, estado, monto_estimado_usd, nota
  ) values (
    rid,
    coalesce(p_datos->>'origen','suelto'),
    p_datos->>'origen_ref',
    coalesce(p_datos->>'destino','unidad'),
    p_datos->>'cam',
    p_datos->>'area',
    coalesce(p_datos->>'urgencia','cuando_se_pueda'),
    p_datos->>'consecuencia',
    coalesce(quien,'(desconocido)'), quien_us, r,
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

  -- ⛔ `anomalias.id` es UUID y `origen_ref` es texto: se compara por TEXTO.
  if coalesce(p_datos->>'origen','') = 'anomalia' and coalesce(p_datos->>'origen_ref','') <> '' then
    update anomalias set req_id = rid
     where id::text = p_datos->>'origen_ref' and estado = 'abierta';
  end if;

  select codigo, numero into cod, num from requisiciones where id = rid;
  return json_build_object('ok', true, 'id', rid, 'codigo', cod, 'numero', num, 'renglones', i);
end $$;

-- ── 2. Decidir, y avisarle a quien pidió ────────────────────────────────────
create or replace function public.req_decidir(
  p_token text, p_decision text, p_cotizacion_id text, p_quien text, p_nota text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q record; ofe record; oid text; cams_ jsonb;
  tel text; msg text; url_base text; sin_aviso text := null;
begin
  if p_decision not in ('aprobar','rechazar','devolver') then
    raise exception 'Decisión no reconocida';
  end if;
  select * into q from requisiciones where token = p_token;
  if q.id is null then return json_build_object('ok', false, 'error', 'Enlace no válido o vencido'); end if;

  if q.decidida_at is not null then
    return json_build_object('ok', true, 'repetido', true, 'estado', q.estado,
      'orden_id', q.orden_id, 'decidida_por', q.decidida_por,
      'mensaje', 'Este requisitorio ya se decidió el ' || to_char(q.decidida_at,'DD/MM/YYYY HH24:MI'));
  end if;

  -- El teléfono de QUIEN PIDIÓ. Si no lo tiene cargado, la decisión igual se
  -- aplica: lo que no puede pasar es perder la decisión por no poder avisar.
  select u.wa into tel from btg_usuarios u
   where coalesce(u.activo,true)
     and ( (q.solicitante_usuario is not null and u.usuario = q.solicitante_usuario)
        or (q.solicitante_usuario is null and u.nombre = q.solicitante) )
     and coalesce(u.wa,'') <> ''
   limit 1;
  if coalesce(tel,'') = '' then
    sin_aviso := 'No se le avisó a quien pidió: no tiene WhatsApp cargado.';
  end if;

  select valor into url_base from configuracion where clave='app_url';
  url_base := btrim(coalesce(url_base,''));

  if p_decision = 'rechazar' then
    update requisiciones set estado='rechazada', decidida_at=now(),
           decidida_por=coalesce(p_quien,'(sin nombre)'), decision_nota=p_nota,
           nota = case when sin_aviso is null then nota else coalesce(nota||' · ','')||sin_aviso end
     where id=q.id;
    if tel is not null then
      msg := 'Su pedido ' || coalesce(q.codigo,'') || ' NO fue aprobado.' || chr(10) || chr(10) ||
             coalesce(nullif(q.cam,'') || chr(10), '') ||
             case when coalesce(p_nota,'') <> '' then 'Motivo: ' || p_nota || chr(10) else '' end ||
             chr(10) || 'Decidió: ' || coalesce(p_quien,'') ||
             chr(10) || chr(10) || 'Si hace falta insistir, hable con quien firma antes de volver a pedirlo.';
      insert into cola_mensajes (tipo, telefono, mensaje, ref)
      values ('requisitorio', tel, msg, 'req_dec_' || left(q.id,14));
    end if;
    return json_build_object('ok', true, 'estado', 'rechazada', 'aviso', tel is not null, 'motivo', sin_aviso);
  end if;

  if p_decision = 'devolver' then
    -- Vuelve a COMPRAS, así que el aviso va a quien lo tomó, no a quien pidió:
    -- el pedido sigue vivo y quien tiene que hacer algo es compras.
    update requisiciones set estado='tomada', decision_nota=p_nota,
           token=null, firma_pedida_at=null where id=q.id;
    select u.wa into tel from btg_usuarios u
     where coalesce(u.activo,true) and u.nombre = q.tomada_por and coalesce(u.wa,'') <> '' limit 1;
    if tel is not null then
      msg := coalesce(q.codigo,'') || ' fue devuelto sin aprobar.' || chr(10) || chr(10) ||
             coalesce('Nota: ' || nullif(p_nota,'') || chr(10), '') ||
             'De: ' || coalesce(p_quien,'') || chr(10) || chr(10) ||
             'El pedido sigue vivo: corrija lo que haga falta y vuelva a pedir la firma.';
      insert into cola_mensajes (tipo, telefono, mensaje, ref)
      values ('requisitorio', tel, msg, 'req_dev_' || left(q.id,14));
    end if;
    return json_build_object('ok', true, 'estado', 'tomada', 'devuelto', true);
  end if;

  -- APROBAR
  if coalesce(p_cotizacion_id,'') <> '' then
    select * into ofe from req_cotizaciones where id = p_cotizacion_id and req_id = q.id;
  else
    select * into ofe from req_cotizaciones where req_id = q.id and recomendada limit 1;
  end if;
  if ofe.id is null then
    select * into ofe from req_cotizaciones where req_id = q.id order by monto_usd limit 1;
  end if;

  update req_cotizaciones set elegida = (id = ofe.id) where req_id = q.id;

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
         atendida_at=now(),
         nota = case when sin_aviso is null then nota else coalesce(nota||' · ','')||sin_aviso end
   where id = q.id;

  if tel is not null then
    msg := 'Su pedido ' || coalesce(q.codigo,'') || ' fue APROBADO.' || chr(10) || chr(10) ||
           coalesce(nullif(q.cam,'') || chr(10), '') ||
           'Proveedor: ' || coalesce(ofe.proveedor,'') || chr(10) ||
           'Monto: US$ ' || to_char(coalesce(ofe.monto_usd,0),'FM999G999G990D00') || chr(10) ||
           case when ofe.dias_entrega is not null
                then 'Entrega estimada: ' || ofe.dias_entrega || ' día' || case when ofe.dias_entrega=1 then '' else 's' end || chr(10)
                else '' end ||
           chr(10) || 'Aprobó: ' || coalesce(p_quien,'') || chr(10) || chr(10) ||
           'Cuando llegue, márquelo como recibido en el sistema — eso cierra la falla.';
    insert into cola_mensajes (tipo, telefono, mensaje, ref)
    values ('requisitorio', tel, msg, 'req_apr_' || left(q.id,14));
  end if;

  return json_build_object('ok', true, 'estado','aprobada', 'orden_id', oid,
                           'proveedor', ofe.proveedor, 'monto', ofe.monto_usd,
                           'aviso', tel is not null, 'motivo', sin_aviso);
end $$;

revoke all on function public.req_crear(jsonb, jsonb)                   from anon, authenticated;
revoke all on function public.req_decidir(text, text, text, text, text) from anon, authenticated;
grant execute on function public.req_crear(jsonb, jsonb)                to authenticated;
grant execute on function public.req_decidir(text, text, text, text, text) to anon, authenticated;
