-- ═══════════════════════════════════════════════════════════════════════════════
-- UN AVISO QUE NO CAMBIÓ NO SE VUELVE A MANDAR — 2026-11-04
--
-- Máximo: «reduce a que no sean tantos por día, creo que eso se puede filtrar mucho
-- más, creo que están llegando mensajes que pueden llegar a ser innecesarios».
--
-- 🔴 LA MEDICIÓN, Y LA CORRECCIÓN DE LA MEDICIÓN.
--    Primero se midió normalizando el mensaje y BORRANDO LOS NÚMEROS. Daba 64% de
--    repetición y era FALSO: en «💰 Pago BNC Recibido · Bs 2.400.000» el número es
--    justamente lo que distingue un pago de otro, y al borrarlo 85 pagos distintos
--    parecían el mismo aviso 85 veces. Medir mal acusa al producto de un defecto
--    que no tiene. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
--
--    Medido otra vez quitando SOLO fechas y horas, sobre 771 mensajes de 30 días:
--      repetición real = **132 (17%)**, y se concentra en DOS tipos:
--        · cobros     83 mensajes → 11 distintos → 72 repetidos (87%), en 21 días
--        · vigilante  42 mensajes →  6 distintos → 36 repetidos (86%), en 15 días
--      (gps_reenvio 162→154 distintos y bnc 90→85 distintos NO son repetición:
--       son muchos hechos distintos, y eso se arregla agrupando, no callando.)
--
--    ⇒ Y los dos que repiten son justo los dos que quedaron en el canal limpio.
--      Quitándoles la repetición, el canal limpio pasa de **4,9 a 1,3 por día**.
--
-- LA REGLA
--   Un aviso cuyo texto ya se mandó —misma condición, sin cambios— no se repite
--   hasta que pase su ventana. Cuando vuelve a salir, lo dice: «sigue igual desde el
--   X, van N». Y si el texto CAMBIA, sale enseguida: lo que se calla es la
--   repetición, nunca una novedad.
--
-- ⛔ LOS INFORMES DIARIOS NO SE CALLAN NUNCA, aunque digan lo mismo. `soporte-parte`,
--    `soporte-resumen`, `auditoria` y `alerta` salen todos los días aunque no haya
--    nada que reportar: si un día no llegan, eso significa que algo se rompió. Un
--    canal de entrega caído se ve igual que todo en orden, y silenciarlos sería
--    quitar la única señal que lo distingue. Van con ventana CERO.
--
-- ⛔ LO QUE NO ESTÁ EN `avisos_ruta` NO SE TOCA: sale como hoy. El modo de fallar es
--    ver de más, nunca enterrar algo callado.
--
-- ⛔ REVERSIBLE: UNDO al final. Nada se borra — el aviso repetido SE GUARDA con
--    estado `repetido` y queda el rastro de cuántas veces y desde cuándo.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Cada cuánto puede repetirse cada tipo ───────────────────────────────────
alter table public.avisos_ruta
  add column if not exists repetir_cada interval not null default interval '3 days';

comment on column public.avisos_ruta.repetir_cada is
  'Cuanto hay que esperar para volver a mandar el MISMO aviso sin cambios. interval 0 = nunca se calla (informes diarios, cuyo silencio es la senal de que algo se rompio).';

-- Los informes diarios salen siempre, digan lo que digan.
update public.avisos_ruta set repetir_cada = interval '0', updated_at = now()
 where tipo in ('soporte-parte','soporte-resumen','auditoria','alerta',
                'resumen_socios','resumen_acuse','auditoria_mensual','km_semanal',
                'choferes-dia','bnc','divisas');

-- ── 2) La huella de cada aviso ya mandado ──────────────────────────────────────
create table if not exists public.avisos_huella (
  huella       text primary key,
  tipo         text not null,
  telefono     text not null,
  muestra      text,
  primera_vez  timestamptz not null default now(),
  ultimo_envio timestamptz not null default now(),
  veces        integer not null default 1
);

comment on table public.avisos_huella is
  'Que aviso ya se mando y cuando. La huella ignora fechas y horas pero CONSERVA los numeros: dos pagos de montos distintos son dos avisos distintos, no el mismo repetido.';

create or replace function public.avisos_huella_de(p_tipo text, p_tel text, p_msg text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select md5(coalesce(p_tipo,'') || '|' || regexp_replace(coalesce(p_tel,''),'\D','','g') || '|' ||
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_msg,''), '[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}', '<f>', 'g'),
        '\m[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?\M', '<h>', 'g'),
      '\s+', ' ', 'g'))
$$;

-- ── 3) La puerta ───────────────────────────────────────────────────────────────
-- ⚠️ Se llama `trg_cola_silenciar_repetido` a proposito: alfabeticamente va DESPUES
--    de `trg_cola_normalizar_tel` y de `trg_cola_rutear_aviso`, asi que ve el
--    telefono ya canonizado y ya ruteado. Si corriera antes, guardaria la huella
--    contra un destino que todavia no es el final.
create or replace function public.cola_silenciar_repetido() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  v_ventana interval;
  v_huella  text;
  v_h       public.avisos_huella%rowtype;
begin
  if new.estado is distinct from 'pendiente' and new.estado is not null then
    return new;
  end if;
  select repetir_cada into v_ventana from public.avisos_ruta where tipo = new.tipo;
  -- Sin ruta declarada, o ventana cero: no se toca.
  if v_ventana is null or v_ventana <= interval '0' then return new; end if;

  v_huella := public.avisos_huella_de(new.tipo, new.telefono, new.mensaje);
  select * into v_h from public.avisos_huella where huella = v_huella;

  if v_h.huella is null then
    insert into public.avisos_huella (huella, tipo, telefono, muestra)
    values (v_huella, new.tipo, new.telefono, left(coalesce(new.mensaje,''), 200))
    on conflict (huella) do nothing;
    return new;
  end if;

  if v_h.ultimo_envio > now() - v_ventana then
    -- Se guarda igual, pero NO sale: queda el rastro de que se quiso mandar.
    new.estado := 'repetido';
    new.error  := 'mismo aviso que el de ' || to_char(v_h.ultimo_envio, 'DD/MM HH24:MI')
                  || ' · van ' || (v_h.veces + 1) || ' desde el '
                  || to_char(v_h.primera_vez, 'DD/MM');
    update public.avisos_huella set veces = veces + 1 where huella = v_huella;
    return new;
  end if;

  -- Pasó la ventana y la condición SIGUE: sale, y lo dice.
  new.mensaje := '🔁 Esto sigue igual desde el ' || to_char(v_h.primera_vez, 'DD/MM')
                 || ' (van ' || (v_h.veces + 1) || ' avisos iguales).' || chr(10) || chr(10)
                 || coalesce(new.mensaje, '');
  update public.avisos_huella
     set veces = veces + 1, ultimo_envio = now()
   where huella = v_huella;
  return new;
end;
$$;

drop trigger if exists trg_cola_silenciar_repetido on public.cola_mensajes;
create trigger trg_cola_silenciar_repetido
  before insert on public.cola_mensajes
  for each row execute function public.cola_silenciar_repetido();

-- ── 4) Qué se está callando, para que no sea un filtro ciego ───────────────────
create or replace function public.btg_avisos_callados(p_dias int default 7)
returns table (tipo text, telefono text, callados bigint, desde timestamptz, muestra text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select c.tipo, c.telefono, count(*), min(c.created_at), left(min(c.mensaje), 90)
    from public.cola_mensajes c
   where c.estado = 'repetido'
     and c.created_at > now() - make_interval(days => p_dias)
   group by 1,2
   order by 3 desc;
$$;

revoke all on function public.btg_avisos_callados(int) from public, anon;
grant execute on function public.btg_avisos_callados(int) to authenticated, service_role;
revoke all on table public.avisos_huella from public, anon;

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select tipo, canal, repetir_cada::text ventana
  from public.avisos_ruta
 order by (repetir_cada = interval '0'), canal, tipo;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   drop trigger if exists trg_cola_silenciar_repetido on public.cola_mensajes;
--   drop function if exists public.cola_silenciar_repetido();
--   drop function if exists public.btg_avisos_callados(int);
--   drop function if exists public.avisos_huella_de(text,text,text);
--   drop table if exists public.avisos_huella;
--   alter table public.avisos_ruta drop column if exists repetir_cada;
-- ═══════════════════════════════════════════════════════════════════════════════
