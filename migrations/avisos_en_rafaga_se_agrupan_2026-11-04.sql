-- ═══════════════════════════════════════════════════════════════════════════════
-- SIETE AVISOS DEL MISMO ASUNTO SON UN MENSAJE — 2026-11-04
--
-- 🔴 LO QUE PASÓ A LAS 21:00. El canal «limpio», que había prometido en 1,3 avisos
--    por día, recibió SIETE en dos segundos: un `cobros` por cada factura de la 646
--    a la 652. El filtro anti-repetición no los frenó, y hacía bien: son siete
--    textos DISTINTOS. Lo que necesitan no es deduplicación, es AGRUPACIÓN.
--
-- ⛔ MEDÍ MAL EL PROBLEMA. Conté repetición (17%) y no conté RÁFAGAS. Un canal
--    puede recibir pocos avisos distintos y aun así ser ilegible si llegan todos
--    juntos. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
--
-- LA CASA YA TENÍA EL AGRUPADOR: `cola_agrupar_avisos()`, cada 2 minutos. Pero su
-- lista de tipos estaba CLAVADA EN EL CÓDIGO —('app','chofer','recordatorio')— y
-- `cobros` no estaba. Una lista a mano dentro de una función es justo la que nadie
-- actualiza. Pasa a la tabla, al lado del ruteo, para que haya UN solo sitio donde
-- mirar qué hace la casa con cada tipo de aviso. [[norma-dos-listas-a-mano-se-desincronizan]]
--
-- ⛔ Y LA CARRERA, QUE ES LO QUE DE VERDAD LO ROMPÍA. El agrupador corre cada 2 min
--    y el worker cada 3: si el worker llega primero, manda los sueltos y el
--    agrupador no tiene nada que juntar. Agrupar sin cerrar eso no garantiza nada.
--    ⇒ El worker va a saltarse los tipos agrupables mientras tengan menos de 90
--      segundos. **Falla ABIERTO**: si el agrupador se muere, los mensajes salen
--      igual 90 segundos después, sueltos. Nunca se quedan trabados.
--      Se descartó el camino de un estado nuevo («agrupando») justamente porque
--      falla CERRADO: con el agrupador caído, los mensajes se quedarían ahí y el
--      silencio se vería igual que «no pasó nada».
--
-- ⛔ REVERSIBLE: UNDO al final.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) La lista de lo agrupable, junto a la del ruteo ──────────────────────────
-- `canal` pasa a admitir NULL: un tipo puede estar acá solo para agruparse, sin
-- que nadie le cambie el destino. El trigger de ruteo ya no toca lo que no tiene
-- canal (el join no devuelve fila), así que esto no mueve ningún destino.
alter table public.avisos_ruta alter column canal drop not null;
alter table public.avisos_ruta add column if not exists agrupar boolean not null default false;

comment on column public.avisos_ruta.agrupar is
  'true = varios avisos de este tipo al MISMO telefono dentro de la ventana se mandan como UN mensaje. Lo lee el agrupador y tambien el worker, que espera 90 s antes de tocarlos.';

-- Los que llegan en rafaga. Medido sobre 30 dias.
insert into public.avisos_ruta (tipo, canal, agrupar, nota) values
  ('cobros',      'limpio', true, 'SIETE juntos el 04/11 (una factura cada uno). Es el caso que obligo a esto.'),
  ('vigilante',   'limpio', true, 'Mensajes que no salieron: llegan varios de una.'),
  ('gps_reenvio', 'todo',   true, '161 en 30 dias, el mas ruidoso.'),
  ('gps_apagon',  'todo',   true, '40 en 30 dias.'),
  ('app',         'todo',   true, 'Ya estaba en la lista vieja del codigo.'),
  ('latido',      'todo',   true, '54 en 30 dias.'),
  ('bnc',         'todo',   true, 'Un mensaje por cada pago que entra: 90 en 30 dias.'),
  -- Estos dos venian en la lista clavada del codigo y NO tienen canal: no se les
  -- cambia el destino, solo se los sigue agrupando como hasta hoy.
  ('chofer',       null,    true, 'Venia de la lista clavada en cola_agrupar_avisos.'),
  ('recordatorio', null,    true, 'Venia de la lista clavada en cola_agrupar_avisos.')
on conflict (tipo) do update
  set agrupar = excluded.agrupar,
      nota    = coalesce(public.avisos_ruta.nota, excluded.nota),
      updated_at = now();

-- ── 2) El agrupador lee la tabla, y espera a que la rafaga termine ─────────────
create or replace function public.cola_agrupar_avisos()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r         record;
  v_texto   text;
  v_n       integer := 0;
  v_grupos  integer := 0;
  v_id      bigint;
  v_cab     text;
begin
  for r in
    select telefono, tipo, count(*) n, array_agg(id order by id) ids
      from public.cola_mensajes
     where estado = 'pendiente'
       -- ⛔ La lista NO va clavada acá: vive en `avisos_ruta.agrupar`, al lado del
       --    ruteo. Antes era ('app','chofer','recordatorio') en el codigo y por eso
       --    `cobros` mando siete sueltos el 04/11/2026.
       and tipo in (select tipo from public.avisos_ruta where agrupar)
       -- ⛔ SE ESPERA A QUE LA RAFAGA TERMINE. Juntar a los 10 segundos partiria en
       --    dos un grupo que todavia se esta escribiendo.
       and created_at < now() - interval '45 seconds'
       and created_at > now() - interval '15 minutes'
     group by telefono, tipo
    having count(*) > 1
  loop
    v_grupos := v_grupos + 1;
    v_n := v_n + r.n;

    select case when count(distinct split_part(mensaje, chr(10), 1)) = 1
                then max(split_part(mensaje, chr(10), 1)) else null end
      into v_cab
      from public.cola_mensajes where id = any(r.ids);

    select coalesce(v_cab || chr(10) || chr(10), '') ||
           '📋 ' || r.n || ' avisos juntos:' || chr(10) ||
           string_agg(
             '────────' || chr(10) ||
             case when v_cab is null then mensaje
                  else ltrim(substr(mensaje, length(v_cab) + 1), chr(10)) end,
             chr(10) order by id)
      into v_texto
      from public.cola_mensajes where id = any(r.ids);

    -- ⛔ Si el juntado se pasa de largo, se deja como estaba. WhatsApp corta cerca de
    --    los 4.096 caracteres y un aviso cortado a la mitad es peor que varios enteros.
    if length(v_texto) > 3800 then continue; end if;

    insert into public.cola_mensajes (tipo, telefono, mensaje, estado, ref)
    values (r.tipo, r.telefono, v_texto, 'pendiente',
            'agrupado:' || r.tipo || ':' || to_char(now(), 'YYYYMMDDHH24MISS') || ':' || r.telefono)
    returning id into v_id;

    update public.cola_mensajes
       set estado = 'agrupado',
           error  = 'se junto con otros ' || (r.n - 1) || ' en el mensaje ' || v_id
     where id = any(r.ids);
  end loop;
  return v_grupos;
end;
$function$;

comment on function public.cola_agrupar_avisos() is
  'Junta en UN mensaje los avisos del mismo tipo al mismo telefono. Que tipos se agrupan lo dice avisos_ruta.agrupar, no una lista en el codigo. Espera 45 s a que la rafaga termine; el worker espera 90 s antes de tocar esos tipos, asi que no corren carrera.';

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select tipo, coalesce(canal,'(no se rutea)') canal, agrupar, repetir_cada::text ventana
  from public.avisos_ruta where agrupar order by tipo;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   alter table public.avisos_ruta drop column if exists agrupar;
--   (y volver a poner la lista clavada en cola_agrupar_avisos:
--    and tipo in ('app','chofer','recordatorio') and created_at > now() - interval '15 minutes')
-- ═══════════════════════════════════════════════════════════════════════════════
