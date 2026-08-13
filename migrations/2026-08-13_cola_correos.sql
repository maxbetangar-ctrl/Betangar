-- ════════════════════════════════════════════════════════════════════════════
-- COLA DE CORREOS — para que la auditoría profunda pueda ENTREGAR su informe.
--
-- POR QUÉ EXISTE (13/08/2026): la auditoría profunda de las 6:00 AM corre bien
-- todos los días desde el 06/08, pero NUNCA entregó un solo correo en 8 días.
-- Su canal era Resend llamado DESDE EL SANDBOX de la rutina, y el proxy de
-- egreso de ese entorno bloquea api.resend.com (403 al CONNECT). El respaldo,
-- Gmail, solo sabe crear BORRADORES. Resultado: informe perfecto, cero entrega.
--
-- LA SOLUCIÓN es la misma que ya funciona para WhatsApp: la rutina no manda
-- nada, solo ENCOLA con un INSERT; quien manda es un worker que corre DENTRO
-- de Supabase (pg_cron → pg_net → Edge Function). Ese camino no pasa por el
-- sandbox, y por eso el WhatsApp de la auditoría liviana sí llega todos los días.
--
-- Molde copiado de `cola_mensajes` + `procesar_cola_wassenger`, con sus lecciones
-- ya aprendidas: claim atómico, rescate de trabados, y el 429 no gasta intentos.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.cola_correos (
  id          bigint generated always as identity primary key,
  para        text        not null,
  asunto      text        not null,
  html        text        not null,
  remitente   text,                                   -- si va null, usa el `from` de la config
  estado      text        not null default 'pendiente',
  intentos    integer     not null default 0,
  error       text,
  ref         text,                                   -- idempotencia: 'audit-2026-08-13'
  created_at  timestamptz not null default now(),
  tomado_at   timestamptz,                            -- marca de RECLAMO, no de envío
  enviado_at  timestamptz
);

-- El worker busca por estado y ordena por id.
create index if not exists cola_correos_pendientes_idx
  on public.cola_correos (estado, id);

-- Un `ref` no se encola dos veces. Si la rutina se reintenta el mismo día, el
-- segundo INSERT choca en vez de mandarte el mismo informe repetido.
create unique index if not exists cola_correos_ref_idx
  on public.cola_correos (ref) where ref is not null;

-- ── Candado ────────────────────────────────────────────────────────────────
-- Esta tabla lleva el informe de seguridad completo: qué está abierto y dónde.
-- Es de las cosas que MENOS puede leer un desconocido. Solo la toca
-- `service_role` (que salta RLS por diseño). Nadie más: ni anon, ni el personal.
-- RLS encendido y CERO políticas = cerrado para todo el mundo salvo el worker.
alter table public.cola_correos enable row level security;
revoke all on public.cola_correos from anon, authenticated, public;

-- ── La apikey de Resend pasa a ser SECRETA en esta base ────────────────────
-- `configuracion` ya guarda el token de Wassenger y está protegida por la policy
-- `cfg_sel`, que esconde lo que `cfg_clave_secreta()` declare. Al traer la clave
-- de Resend a esta base hay que sumarla a esa lista EN EL MISMO PASO — si no,
-- la app la leería como una configuración cualquiera.
create or replace function public.cfg_clave_secreta(p_clave text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select p_clave in ('wassenger', 'gemini_api_key', 'resend')
$function$;

-- Sensible = además, solo un rol alto puede escribirla.
create or replace function public.cfg_clave_sensible(p_clave text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  select p_clave in (
    'wassenger','gemini_api_key','general',
    'whatsapp','wa_empresarial','recordatorios_cfg','viajes_semanal_tel','tasa_bnc',
    'resend'
  );
$function$;
