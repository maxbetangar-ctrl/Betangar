-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Betangar · 2026-07-31 · Una sola medición de tanque por unidad+fecha+momento
--
-- POR QUÉ: `chofer.html` insertaba liso en `combustible_mediciones` (sin upsert) y la tabla no
-- tenía UNIQUE. Cada toque del botón —y cada pasada simultánea de `sincronizarCola()`— creaba
-- una fila nueva. Resultado: 216 filas repetidas en 6 semanas (93% con la MISMA altura, o sea
-- sin dato nuevo) y un WhatsApp diario del cron de auditoría reclamándole a 6 choferes por algo
-- que hizo la app. Verificado: JAC-B002 25/07 tiene TRES filas en 211 milésimas de segundo.
--
-- QUÉ HACE:
--   1. Respalda en `combustible_mediciones_dup_bkp` TODAS las filas que se van a colapsar.
--      No se pierde nada: si alguna hacía falta, está ahí con su id y su created_at original.
--   2. Deja UNA fila por (vehiculo_id, fecha, momento): la ÚLTIMA por created_at — exactamente
--      el mismo criterio que ya usaba el dedupe de la auditoría, así que ningún número cambia.
--      (Si el chofer corrigió la altura, la corrección es la que manda. Eso ya era así.)
--   3. Pone el UNIQUE que faltaba, para que el `upsert` del chofer tenga contra qué chocar.
--      Los NULL de `vehiculo_id` quedan libres a propósito: la medición del GALPÓN no es de una
--      unidad y no debe quedar trancada por este candado.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. RESPALDO ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.combustible_mediciones_dup_bkp
  (like public.combustible_mediciones including defaults);
alter table public.combustible_mediciones_dup_bkp
  add column if not exists respaldado_el timestamptz not null default now();

insert into public.combustible_mediciones_dup_bkp
select m.* from public.combustible_mediciones m
where m.id in (
  select id from (
    select id, row_number() over (partition by vehiculo_id, fecha, momento
                                  order by created_at desc, id desc) rn
    from public.combustible_mediciones) r
  where r.rn > 1);

-- Tabla nueva = anon fuera (norma Betangar: los grants por defecto del esquema la abren sola).
alter table public.combustible_mediciones_dup_bkp enable row level security;
revoke all on public.combustible_mediciones_dup_bkp from anon;
create policy cmb_sel on public.combustible_mediciones_dup_bkp
  for select to authenticated using (true);

-- ── 2. COLAPSAR ─────────────────────────────────────────────────────────────────────────────
delete from public.combustible_mediciones m
where m.id in (
  select id from (
    select id, row_number() over (partition by vehiculo_id, fecha, momento
                                  order by created_at desc, id desc) rn
    from public.combustible_mediciones) r
  where r.rn > 1);

-- ── 3. EL CANDADO ───────────────────────────────────────────────────────────────────────────
create unique index if not exists uq_comb_med_unidad_fecha_momento
  on public.combustible_mediciones (vehiculo_id, fecha, momento);
