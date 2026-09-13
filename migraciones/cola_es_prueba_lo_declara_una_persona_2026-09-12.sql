-- ============================================================================
-- `es_prueba`: QUE UN DATO DE PRUEBA PUEDA DECIR QUE LO ES   ·   12/09/2026
--
-- 🔴 POR QUÉ. Hoy `puede-hablar.mjs` encontró 6 mensajes bloqueados en Tony Gas.
--    Cuatro eran pedidos de autorización al C.E.O. con dos requisiciones en
--    `espera_firma` desde hacía 9 y 5 días. Se midió, se preparó el reenvío y se
--    preguntó — y Máximo contestó: **«esas requisiciones son de prueba»**.
--    ⇒ Un dato de PRUEBA en la base de un cliente se ve **exactamente igual** que
--      trabajo real trancado. Me mandó a perseguir nueve días de un pedido que no
--      existe, y a la auditoría le va a pasar lo mismo cada vez que mire.
--
-- ⛔ POR QUÉ VA EN `cola_mensajes` Y NO EN `requisiciones`. Hoy mismo aprendimos
--    con `en_nomina` que **una columna que nadie lee es peor que no tenerla**:
--    invita a apoyarse en ella. `requisiciones.es_prueba` no lo consumiría nadie
--    —los `req_*` no lo miran— mientras que acá lo leen YA dos piezas: las dos
--    secciones de `cola_vigilante` que avisan. La marca va donde se consume.
--    [[norma-la-pieza-dice-lo-que-no-hace]] · [[norma-default-en-campo-que-se-declara]]
--
-- ⚠️ NO ADIVINA. No se marca por el nombre del tipo ni por el texto: lo de prueba
--    **lo declara una persona** con `cola_marcar_prueba(ids, motivo)`, y queda
--    escrito QUIÉN y POR QUÉ. Un `es_prueba` puesto por un patrón terminaría
--    escondiendo trabajo real el día que el patrón acierte de más.
-- ============================================================================

alter table public.cola_mensajes
  add column if not exists es_prueba boolean not null default false;

comment on column public.cola_mensajes.es_prueba is
  'Lo declaró una persona con `cola_marcar_prueba()`: este mensaje es de una PRUEBA, '
  'no de trabajo real. `cola_vigilante()` NO lo cuenta ni en los bloqueados ni en los '
  'recuperables. ⛔ No se pone por patrón ni por el nombre del `tipo`: un dato de prueba '
  'mal adivinado esconde trabajo de verdad. El motivo y quién lo marcó quedan en `nota_prueba`.';

alter table public.cola_mensajes
  add column if not exists nota_prueba text;

comment on column public.cola_mensajes.nota_prueba is
  'Quién marcó el mensaje como prueba y por qué. Sin esto, `es_prueba` es una afirmación '
  'sin dueño — y dentro de seis meses nadie sabe si taparlo estuvo bien.';

-- ── Marcar, a propósito y por id ────────────────────────────────────────────
create or replace function public.cola_marcar_prueba(p_ids bigint[], p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare v_ok bigint[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('error', 'Decime QUÉ filas. No marca "todo" a propósito.');
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    return jsonb_build_object('error', 'Falta el motivo. Una marca sin motivo no se puede revisar después.');
  end if;
  with upd as (
    update public.cola_mensajes
       set es_prueba = true,
           nota_prueba = btrim(p_motivo) || ' — marcado ' || to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY HH24:MI')
     where id = any(p_ids)
    returning id
  )
  select array_agg(id) into v_ok from upd;
  return jsonb_build_object('marcados', coalesce(v_ok, '{}'),
    'aviso', 'El vigilante deja de contarlos. Para deshacer: update cola_mensajes set es_prueba=false where id = any(...)');
end;
$fn$;

revoke execute on function public.cola_marcar_prueba(bigint[], text) from public, anon;

-- ── El vigilante, que ahora los saltea ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cola_vigilante()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_s        jsonb;
  v_destino  text;
  v_correo   boolean;
  v_txt      text;
  v_ids      bigint[];
  v_motivos  text;
  v_avisado  text[] := '{}';
  v_cuando   timestamptz;
  v_rec_ids  bigint[];
  v_rec_ref  text;
begin
  v_s := public.cola_salud();

  -- ══ 0) LO QUE REBOTÓ CON LA PUERTA CERRADA Y HOY YA PODRÍA PASAR ══════════
  -- 🔴 12/09/2026. En Tony Gas, cuatro pedidos de autorización al C.E.O. salieron
  --    `bloqueado` por destino no autorizado el 04 y el 08/09. Después alguien
  --    autorizó ese número — y **los mensajes se quedaron bloqueados para
  --    siempre**: nada los reintenta ni los nombra. La puerta se abrió y lo que
  --    había golpeado antes quedó afuera, en silencio.
  --
  -- ⛔ VA ANTES DEL `return` DE «cola sana», a propósito. Esto pasa justamente
  --    cuando todo lo demás está bien: la cola envía, no hay males, `sana` es
  --    true… y hay mensajes recuperables que nadie ve. Abajo del return no
  --    correría nunca. [[norma-la-puerta-que-no-existe]]
  --
  -- ⚠️ NO LOS REENVÍA SOLO, Y ESO ES LO IMPORTANTE. Un pedido de autorización de
  --    hace nueve días reenviado a ciegas confunde más de lo que ayuda: puede ser
  --    de algo ya resuelto, anulado o de prueba — en Tony Gas eran de prueba.
  --    Se NOMBRA y decide una persona, con `cola_reintentar(ids)`.
  --    [[norma-el-documento-no-es-el-dato-de-hoy]]
  --
  -- ⚠️ Pregunta con `wa_destino_permitido()`, así que cubre los DOS caminos por
  --    los que un número queda autorizado: la lista blanca y el teléfono cargado
  --    en `empleados`.
  --
  -- ⚠️ La deduplicación va por `ref`, como el resto de esta función, y NO por
  --    `cola_vigilante_visto`: esas filas YA están marcadas ahí por el aviso de
  --    bloqueados, así que ese camino no habría disparado nunca. Si el conjunto
  --    cambia, cambia el md5 y se vuelve a avisar; si no cambia, se calla.
  select array_agg(m.id order by m.id)
    into v_rec_ids
    from public.cola_mensajes m
   where m.estado = 'bloqueado'
     and m.error ilike '%destino no autorizado%'
     and not coalesce(m.es_prueba, false)
     and public.wa_destino_permitido(m.telefono);

  if v_rec_ids is not null and cardinality(v_rec_ids) > 0 then
    v_rec_ref := 'cola-vig:recup:' || md5(v_rec_ids::text);
    if not exists (select 1 from public.cola_mensajes where ref = v_rec_ref)
       and public.cola_alarma_destino() is not null then
      insert into public.cola_mensajes (tipo, telefono, mensaje, ref)
      values ('vigilante', public.cola_alarma_destino(),
        '🔓 ' || cardinality(v_rec_ids) || ' mensaje(s) que habían rebotado por destino no ' ||
        'autorizado AHORA SÍ podrían salir: ese número ya está autorizado.' || chr(10) || chr(10) ||
        (select string_agg('· fila ' || m.id || ' — ' || m.telefono || ' — del ' ||
                           to_char(m.created_at, 'DD/MM'), chr(10) order by m.id)
           from public.cola_mensajes m where m.id = any(v_rec_ids)) || chr(10) || chr(10) ||
        'NO se reenviaron solos: uno viejo puede ser de algo ya resuelto, anulado o de prueba. ' ||
        'Mirá de qué son y, los que sigan valiendo: select cola_reintentar(array[ids]);',
        v_rec_ref);
      v_avisado := array_append(v_avisado, 'recuperables');
    end if;
  end if;

  -- ⛔ EL RETURN TEMPRANO NO PUEDE DESMENTIR A LA SECCION 0. Probado en Tony Gas:
  --    el aviso de recuperables SI se encolaba, pero la funcion devolvia
  --    «nada que avisar» porque este return pisaba `v_avisado`. Una pieza que
  --    hace algo y reporta que no hizo nada es la peor de las dos.
  --    [[norma-la-pieza-dice-lo-que-no-hace]]
  if (v_s->>'sana')::boolean then
    return v_s || jsonb_build_object('aviso',
      case when cardinality(v_avisado) > 0 then to_jsonb(v_avisado)
           else to_jsonb('nada que avisar'::text) end);
  end if;

  v_destino := public.cola_alarma_destino();
  v_correo  := to_regclass('public.cola_correos') is not null;

  -- ══ 1) MENSAJES BLOQUEADOS ════════════════════════════════════════════════
  -- La cola funciona; lo que falló es un destino. El aviso sí puede ir por ahí.
  if (v_s->>'sin_avisar')::int > 0 and (v_s->>'cola_usable')::boolean and v_destino is not null then
    -- ⛔ EL AVISO NO REPITE EL MOTIVO TAL CUAL. Medido el 11/09: el motivo
    --    escrito era *«el texto contiene “inteligencia artificial”»*, el aviso lo
    --    citó, y **el candado de marca bloqueó el aviso**. Un mensaje que habla
    --    de palabras prohibidas no puede llevarlas adentro.
    --    [[norma-nada-que-insinue-ia-al-cliente]] [[candado-marca-vive-en-el-worker]]
    -- ⇒ Se dice la CLASE de falla y el id de la fila. Con eso se actúa, y el
    --    texto exacto se mira en la base, que es donde no molesta a nadie.
    select array_agg(m.id order by m.id),
           string_agg(distinct '· ' || m.telefono || ' — ' || case
             when m.error ilike '%destino no autorizado%'
               then 'el número no está autorizado en esta base'
             when m.error ilike '%candado de marca%'
               then 'el texto llevaba una palabra que el candado de marca no deja pasar'
             when m.error is null or btrim(m.error) = ''
               then 'sin motivo escrito (fila ' || m.id || ')'
             else 'otro motivo — mirar la fila ' || m.id end, chr(10))
      into v_ids, v_motivos
      from public.cola_mensajes m
     where m.estado = 'bloqueado'
       and coalesce(m.tipo,'') <> 'vigilante'
       -- ⛔ Lo marcado como PRUEBA no se cuenta: ver `cola_marcar_prueba`.
       and not coalesce(m.es_prueba, false)
       and not exists (select 1 from public.cola_vigilante_visto v where v.cola_id = m.id);

    insert into public.cola_mensajes (tipo, telefono, mensaje, ref)
    values ('vigilante', v_destino,
      '🚨 ' || cardinality(v_ids) || ' mensaje(s) NO salieron y se quedaron trancados:' ||
      chr(10) || chr(10) || v_motivos || chr(10) || chr(10) ||
      'Están guardados con el motivo escrito, no se perdieron. Si el destino es ' ||
      'legítimo, hay que autorizarlo y volver a encolarlos.',
      'cola-vig:bloq:' || md5(v_ids::text));

    -- ⚠️ Marcar DESPUÉS de encolar, y solo lo que entró en ESTE aviso.
    insert into public.cola_vigilante_visto (cola_id)
    select unnest(v_ids) on conflict (cola_id) do nothing;
    v_avisado := array_append(v_avisado, 'bloqueados');
  end if;

  -- ══ 2) COLA TRANCADA o SIN WORKER ═════════════════════════════════════════
  -- Lo estructural. Un aviso que se repite cada corrida deja de leerse: se
  -- recuerda una vez al día mientras siga roto — igual que `latidos_vigilar`.
  if (v_s->'males' ? 'sin_worker') or (v_s->'males' ? 'trancada')
     or (v_s->'males' ? 'alarma_bloqueada') then
    select max(created_at) into v_cuando
      from public.cola_mensajes where tipo = 'vigilante' and ref like 'cola-vig:estruct%';
    -- ⚠️ La marca se busca también en el correo: si se avisó por ahí, no se
    --    repite por el otro canal.
    if v_correo then
      select greatest(coalesce(v_cuando, '-infinity'::timestamptz), coalesce(max(created_at), '-infinity'::timestamptz))
        into v_cuando from public.cola_correos where ref like 'cola-vig:estruct%';
    end if;

    if v_cuando is null or v_cuando < now() - interval '20 hours' then
      v_txt := case
        when (v_s->'males' ? 'sin_worker')
          then 'NADA está vaciando la cola de WhatsApp de esta base: no hay tarea programada que llame al worker. Todo lo que se encole se queda adentro, en silencio.'
        when (v_s->'males' ? 'trancada')
          then 'La cola de WhatsApp está trancada: ' || (v_s->>'pendientes') ||
               ' mensaje(s) esperando, el más viejo desde hace ' || (v_s->>'espera_min') || ' min.'
        -- ⚠️ Este caso NO puede salir por la cola: la cola es justo lo que rechazó
        --    el aviso anterior. Si sale por ahí, se bloquea igual.
        else 'El aviso del vigilante quedó BLOQUEADO en la cola de esta base. La cola funciona para todo lo demás, pero el aviso no pasa: hay que mirar por qué en `cola_mensajes` (tipo=vigilante, estado=bloqueado).' end;

      if v_correo then
        insert into public.cola_correos (para, asunto, html, ref)
        values (coalesce((select nullif(btrim(valor),'') from public.configuracion where clave='cola_alarma_correo' limit 1),
                         'maxbetangar@gmail.com'),
                '🚨 Cola de WhatsApp: ' || (v_s->>'males'),
                '<p>' || v_txt || '</p><pre>' || v_s::text || '</pre>',
                'cola-vig:estruct:' || to_char(now(),'YYYYMMDDHH24MI'));
        v_avisado := array_append(v_avisado, 'estructural:correo');
      elsif v_destino is not null and not (v_s->'males' ? 'alarma_bloqueada') then
        -- ⚠️ Último recurso: por la cola misma. Si está trancada no va a salir
        --    hoy, pero queda encolado y sale en cuanto alguien la destranque —
        --    con la fecha del día en que se detectó, que es el dato que importa.
        insert into public.cola_mensajes (tipo, telefono, mensaje, ref)
        values ('vigilante', v_destino, '🚨 ' || v_txt,
                'cola-vig:estruct:' || to_char(now(),'YYYYMMDDHH24MI'));
        v_avisado := array_append(v_avisado, 'estructural:cola(trancada)');
      else
        v_avisado := array_append(v_avisado, 'estructural:SIN CANAL');
      end if;
    end if;
  end if;

  return v_s || jsonb_build_object('aviso', to_jsonb(v_avisado));
end $function$
;
