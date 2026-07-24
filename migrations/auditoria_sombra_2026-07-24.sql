-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- MODO SOMBRA DE LA AUDITORÍA DE COMBUSTIBLE — el dataset que mide al auditor
--
-- Por qué existe (paso 7 de DISENO_AUDITORIA_COMBUSTIBLE.md):
-- El aviso de sustracción por WhatsApp está apagado desde el 2026-07-24 porque venía acusando en
-- falso. Para volver a encenderlo no alcanza con "ya lo arreglamos": hace falta PRUEBA. El cron
-- sigue calculando los hallazgos de faltante y los guarda acá con veredicto PENDIENTE, sin mandar
-- nada. Una persona marca cada uno como verdadera o falsa, y ese veredicto humano es lo único que
-- puede decir si el auditor ya se ganó el derecho a hablar.
--
-- NO se usó `combustible_alertas`: esa tabla es del módulo viejo de Control Combustible, que manda
-- WhatsApp automático a socios cuando la severidad es 'critica'. Meter acá los hallazgos en sombra
-- dispararía justo lo que se está tratando de evitar.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.comb_auditoria_sombra (
  id             uuid primary key default gen_random_uuid(),
  -- Idempotencia: el cron corre todos los días y puede reprocesar. Cada hallazgo entra UNA vez.
  alert_key      text not null unique,
  fecha          date not null,
  regla          text not null,                 -- 'R1' (faltó combustible en el patio)
  cam            text,
  litros         numeric,                       -- el faltante (negativo)
  tolerancia     numeric,                       -- el ±TOL de ESAS lecturas, para poder juzgarlo después
  detalle        text not null,                 -- el texto tal cual lo vería un humano
  veredicto      text not null default 'pendiente',
  veredicto_por  text,
  veredicto_nota text,
  veredicto_at   timestamptz,
  created_at     timestamptz not null default now(),
  constraint comb_auditoria_sombra_veredicto_chk
    check (veredicto in ('pendiente','verdadera','falsa'))
);

create index if not exists comb_auditoria_sombra_fecha_idx on public.comb_auditoria_sombra (fecha desc);
create index if not exists comb_auditoria_sombra_veredicto_idx on public.comb_auditoria_sombra (veredicto);

alter table public.comb_auditoria_sombra enable row level security;

-- RLS VERBO POR VERBO (norma del repo: nunca `for all`, que abre lo que no se pensó abrir).
-- • SELECT: cualquier usuario logueado del sistema. Nunca anon: son hallazgos sensibles.
-- • UPDATE: solo para dar el veredicto, y solo administración/socios. El chofer no se juzga solo.
-- • INSERT/DELETE: NINGUNA policy a propósito → solo la edge function (service_role) puede escribir.
--   Un hallazgo no se inventa ni se borra desde la pantalla; si se borrara, el dataset que mide al
--   auditor podría maquillarse y el criterio de reencendido no valdría nada.
drop policy if exists sombra_select on public.comb_auditoria_sombra;
create policy sombra_select on public.comb_auditoria_sombra
  for select to authenticated using (true);

drop policy if exists sombra_update_veredicto on public.comb_auditoria_sombra;
create policy sombra_update_veredicto on public.comb_auditoria_sombra
  for update to authenticated
  using (public.app_rol() in ('superadmin','admin','socios'))
  with check (public.app_rol() in ('superadmin','admin','socios'));

-- Y además, a nivel de columnas: aunque alguien tenga UPDATE, solo puede tocar el veredicto.
-- Los litros, la fecha y el detalle del hallazgo son inmutables — es la evidencia.
revoke update on public.comb_auditoria_sombra from authenticated;
grant  update (veredicto, veredicto_por, veredicto_nota, veredicto_at)
  on public.comb_auditoria_sombra to authenticated;
grant  select on public.comb_auditoria_sombra to authenticated;

-- ⚠️ La tabla NACE con los grants por defecto del esquema: `anon` queda con INSERT/SELECT/UPDATE
-- sobre todas las columnas aunque uno no lo pida. El RLS lo tapa, pero la norma es cerrar en los
-- DOS niveles — si algún día alguien desactiva RLS para depurar, esto no puede quedar abierto.
-- (Es la misma firma de regresión que ya nos mordió antes con otros grants a anon.)
revoke all on public.comb_auditoria_sombra from anon;
revoke insert, delete, references, truncate on public.comb_auditoria_sombra from authenticated;
grant select on public.comb_auditoria_sombra to authenticated;
grant update (veredicto, veredicto_por, veredicto_nota, veredicto_at)
  on public.comb_auditoria_sombra to authenticated;

comment on table public.comb_auditoria_sombra is
  'Hallazgos de faltante de combustible en MODO SOMBRA: se calculan y se guardan sin avisar por WhatsApp, y una persona los marca verdadera/falsa. Ese veredicto es el que habilita (o no) volver a encender AVISAR_SUSTRACCION en la edge function auditar-combustible.';
