-- ═══════════════════════════════════════════════════════════════════════════════
-- ANULAR UN REQUISITORIO — lo pidió Alejandra el 04/09: «¿Cómo se podría anular?»
--
-- 🔴 EL ESTADO `anulada` YA EXISTÍA en el constraint de `requisiciones` desde que se
--    montó el módulo. Lo que no existía era NADA que lo pudiera poner: ni RPC ni
--    botón. El modelo previó la anulación y el circuito nunca se construyó — el
--    mismo hueco que el botón de «entregar» de las maestras.
--
-- ⛔ NO SE BORRA, SE ANULA. Un pedido borrado se lleva consigo quién lo pidió, qué
--    pedía y por qué se cayó. Un pedido anulado queda, con su motivo y su firma.
--    Y el correlativo no se reusa: [[norma-correlativo-se-sincroniza-con-lo-importado]].
--
-- ⛔ NO SE PUEDE ANULAR LO QUE YA SE APROBÓ. Al aprobar nace una ORDEN DE SERVICIO
--    real (`ordenes_servicio`), y anular el pedido dejando la orden viva parte el
--    rastro en dos: la plata seguiría comprometida sin pedido que la explique.
--    Se dice qué hacer en su lugar, en vez de dejar a la persona adivinando.
--
-- ⛔ EXIGE MOTIVO. Una anulación sin motivo es un agujero en el expediente tres
--    meses después, cuando nadie se acuerda. [[norma-el-motivo-escrito-tambien-vence]]
--
-- ⚠️ Y AVISA A QUIEN CORRESPONDE, que no siempre es el mismo:
--    · si estaba en compras (`tomada`/`cotizando`/`espera_firma`) → avisa a QUIEN LO TOMÓ,
--      porque es quien está trabajando en algo que acaba de morir;
--    · si no salió de quien pidió → avisa a QUIEN PIDIÓ.
--    Si el pedido se anula y nadie se entera, compras sigue cotizando un muerto.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.req_anular(p_id text, p_motivo text, p_quien text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  q record; tel text; msg text; a_quien text;
begin
  if coalesce(btrim(p_motivo),'') = '' then
    return json_build_object('ok', false, 'error', 'Hay que decir por qué se anula. Sin motivo, dentro de tres meses nadie va a saber qué pasó con este pedido.');
  end if;

  select * into q from requisiciones where id = p_id;
  if q.id is null then
    return json_build_object('ok', false, 'error', 'No encuentro ese pedido.');
  end if;

  if q.estado = 'anulada' then
    return json_build_object('ok', true, 'repetido', true, 'estado', 'anulada',
      'mensaje', 'Este pedido ya estaba anulado.');
  end if;

  -- ⛔ Los estados en los que ya hay plata o mercancía de por medio.
  if q.estado in ('aprobada','atendida','recibida','cerrada') then
    return json_build_object('ok', false,
      'error', 'Este pedido ya fue aprobado' ||
               case when coalesce(q.orden_id,'') <> '' then ' y generó la orden ' || q.orden_id else '' end ||
               ', así que no se puede anular desde acá: quedaría una orden viva sin pedido que la explique. ' ||
               'Lo que corresponde es anular esa orden en el módulo de órdenes.');
  end if;

  -- A quién le duele que esto muera: si compras ya lo tenía en la mano, es de compras.
  if q.estado in ('tomada','cotizando','espera_firma') and coalesce(q.tomada_por,'') <> '' then
    a_quien := q.tomada_por;
    select u.wa into tel from btg_usuarios u
     where coalesce(u.activo,true) and u.nombre = q.tomada_por and coalesce(u.wa,'') <> '' limit 1;
  else
    a_quien := coalesce(q.solicitante,'');
    select u.wa into tel from btg_usuarios u
     where coalesce(u.activo,true)
       and ( (q.solicitante_usuario is not null and u.usuario = q.solicitante_usuario)
          or (q.solicitante_usuario is null and u.nombre = q.solicitante) )
       and coalesce(u.wa,'') <> ''
     limit 1;
  end if;

  update requisiciones
     set estado = 'anulada',
         decidida_at = now(),
         decidida_por = coalesce(p_quien,'(sin nombre)'),
         decision_nota = btrim(p_motivo),
         -- ⛔ El token de firma se mata: si quedaba un enlace circulando por WhatsApp,
         --    alguien podía firmar un pedido anulado desde su teléfono.
         token = null,
         firma_pedida_at = null
   where id = q.id;

  if tel is not null then
    msg := 'El pedido ' || coalesce(q.codigo, q.id) || ' fue ANULADO.' || chr(10) || chr(10) ||
           coalesce(nullif(q.cam,'') || chr(10), '') ||
           'Motivo: ' || btrim(p_motivo) || chr(10) ||
           'Anuló: ' || coalesce(p_quien,'') || chr(10) || chr(10) ||
           -- `q` es la foto ANTERIOR al update, así que q.estado es el estado previo.
           case when q.estado in ('tomada','cotizando','espera_firma')
                then 'No siga cotizándolo.'
                else 'Si todavía hace falta, hay que pedirlo de nuevo.' end;
    insert into cola_mensajes (tipo, telefono, mensaje, ref)
    values ('requisitorio', tel, msg, 'req_anu_' || left(q.id,14));
  end if;

  return json_build_object('ok', true, 'estado', 'anulada',
                           'aviso', tel is not null, 'a_quien', a_quien,
                           'motivo_sin_aviso', case when tel is null
                             then 'No se le avisó a ' || coalesce(nullif(a_quien,''),'nadie') || ': no tiene WhatsApp cargado.'
                             else null end);
end $function$;

-- ⛔ TODA FUNCIÓN NACE ABIERTA A PUBLIC: el grant no cierra, hay que REVOCAR.
revoke all on function public.req_anular(text, text, text) from public;
revoke all on function public.req_anular(text, text, text) from anon;
grant execute on function public.req_anular(text, text, text) to authenticated;

comment on function public.req_anular(text, text, text) is
  'Anula un requisitorio que todavia no se aprobo, exigiendo motivo y avisando a quien lo tenia en la mano. Lo pidio Alejandra el 04/09/2026: el estado anulada existia y nada lo podia poner.';
