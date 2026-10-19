-- ============================================================================
-- LOS ACUSES DEL CORREO, EN NUESTRA BASE — webhook de Resend
-- 2026-10-19.
--
-- POR QUÉ EXISTE
-- `enviar-correo-archivo.mjs` preguntaba por el estado de entrega llamando a
-- `GET /emails/{id}` de Resend, y esa llamada devuelve **401**: la llave que
-- tenemos es `restricted_api_key` («restricted to only send emails»). O sea que
-- la autocomprobación de la pieza estaba MUDA — decía «enviado, no se pudo
-- comprobar el estado» en cada envío y nadie lo leía como lo que era.
--
-- ⛔ Y NO SE ARREGLA AMPLIANDO LA LLAVE. Resend solo tiene dos niveles, *Sending*
--    y *Full access*: darle lectura sería darle permiso para crear y revocar
--    llaves. Decisión de Máximo (19/10/2026): «hazlo con el webhook».
--
-- ⛔ ADEMÁS EL WEBHOOK ATRAPA LO QUE LA CONSULTA NO PODÍA. El script miraba
--    durante 45 segundos; un rebote llega minutos u horas después. Con la
--    consulta, ese rebote NO lo veía nadie — y un rebote significa que la
--    dirección no existe y el cliente nunca recibió nada.
--    [[norma-la-barra-que-no-dice-que-sigue]]
--
-- QUÉ ES CADA COSA
--   email.sent             Resend lo aceptó y salió del servidor
--   email.delivered        el servidor del destinatario lo ACEPTÓ   ← esto es «llegó»
--   email.bounced          rebotó: NO llegó, y `detalle` dice por qué
--   email.complained       lo marcaron como spam
--   email.delivery_delayed reintentando; todavía no es un fracaso
--   email.opened / clicked lo abrió / tocó un enlace
--
-- ⚠️ `delivered` NO es «lo leyó». Es que el servidor de destino lo aceptó. Que
--    aparezca en la bandeja y que la persona lo vea son dos cosas más allá.
-- ============================================================================

create table if not exists correo_eventos (
  id           bigserial primary key,
  email_id     text        not null,          -- el id que devolvió Resend al enviar
  tipo         text        not null,          -- email.delivered, email.bounced, …
  ocurrido_en  timestamptz not null,          -- cuándo pasó (lo dice Resend)
  recibido_en  timestamptz not null default now(),  -- cuándo nos enteramos
  destino      text[],
  asunto       text,
  detalle      text,                          -- el motivo, cuando el evento lo trae
  datos        jsonb       not null,
  -- ⛔ UN WEBHOOK REINTENTA. Resend reenvía el mismo evento si no contestamos
  --    200 a tiempo, así que SIN esta restricción el mismo acuse entraría tres
  --    veces y «3 entregas» sería un conteo inventado. La inserción va con
  --    `on conflict do nothing`: repetir un evento tiene que ser inofensivo.
  constraint correo_eventos_unico unique (email_id, tipo, ocurrido_en)
);

create index if not exists correo_eventos_email_idx on correo_eventos (email_id);
create index if not exists correo_eventos_recibido_idx on correo_eventos (recibido_en desc);

comment on table correo_eventos is
  'Acuses de Resend por webhook. `delivered` = el servidor del destinatario lo aceptó; `bounced` = NO llegó. Lo escribe la edge function `resend-webhook`, que verifica la firma antes.';

-- ⛔ CERRADA A TODO EL MUNDO. Acá hay direcciones de correo y asuntos de
--    clientes. La escribe la edge function con la llave de servicio (que no pasa
--    por RLS) y la lee la herramienta con el PAT. Nadie más.
--    Sin `enable`, una tabla nueva nace LEGIBLE para `anon`.
--    [[norma-toda-funcion-nace-abierta-a-public]]
alter table correo_eventos enable row level security;
revoke all on correo_eventos from anon, authenticated;
revoke all on sequence correo_eventos_id_seq from anon, authenticated;

-- ── EL ESTADO DE UN CORREO, EN UNA LÍNEA ────────────────────────────────────
-- Devuelve lo que de verdad se quiere saber, con el orden de gravedad que
-- importa: un rebote manda sobre una entrega aunque haya llegado después, porque
-- lo que define a ese correo es que NO llegó.
create or replace function correo_estado(p_email_id text)
returns table (
  email_id   text,
  estado     text,      -- entregado | rebotado | quejado | demorado | enviado | sin_noticias
  detalle    text,
  ocurrido_en timestamptz,
  eventos    text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with e as (select * from correo_eventos where email_id = p_email_id)
  select
    p_email_id,
    coalesce((
      select case t.tipo
               when 'email.bounced'          then 'rebotado'
               when 'email.complained'       then 'quejado'
               when 'email.delivered'        then 'entregado'
               when 'email.delivery_delayed' then 'demorado'
               when 'email.sent'             then 'enviado'
               else t.tipo end
        from e t
       order by case t.tipo
                  when 'email.bounced'          then 1
                  when 'email.complained'       then 2
                  when 'email.delivered'        then 3
                  when 'email.delivery_delayed' then 4
                  when 'email.sent'             then 5
                  else 6 end
       limit 1), 'sin_noticias'),
    (select t.detalle from e t where t.detalle is not null order by t.ocurrido_en desc limit 1),
    (select max(t.ocurrido_en) from e t),
    (select array_agg(distinct t.tipo) from e t)
$$;

revoke all on function correo_estado(text) from anon, public;

comment on function correo_estado is
  'El estado de un correo en una palabra. ⛔ Un REBOTE manda sobre una entrega aunque sea posterior: lo que define a ese correo es que no llegó. `sin_noticias` NO es «llegó»: es que el webhook todavía no dijo nada (o no está configurado).';
