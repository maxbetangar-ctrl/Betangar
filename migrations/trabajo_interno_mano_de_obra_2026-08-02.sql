-- ════════════════════════════════════════════════════════════════════════════
-- TRABAJO INTERNO (mano de obra propia)   (2026-08-02)   proyecto hrkjddehqnzcqwlkklqm
--
-- CAUSA (reporte de Máximo, 02/08/2026):
--   «Cosas que le hago al camión que solo llevan mano de obra interna — ajustar los frenos
--    los hace mi mecánico, que ya está en nómina. No me genera costo, pero quiero saber
--    cuándo se le hizo y que esté en el historial del camión. Y como esos hay muchos casos.»
--
--   Hasta hoy un trabajo interno se registraba dejando `proveedor` vacío y `costo_usd` en 0.
--   Eso es EXACTAMENTE IGUAL a un registro a medio llenar: nadie puede distinguir
--   «lo hizo mi mecánico y no costó plata» de «falta ponerle el taller y el precio».
--   El dato existía pero no se podía leer, y un $0 sin explicación se lee como un hueco.
--
-- ARREGLO: una columna que DECLARA quién ejecutó el trabajo.
--   'interno'  → mano de obra propia (mecánico en nómina). Costo $0 es legítimo y explícito.
--   'externo'  → taller/proveedor de la calle (lo de siempre).
--   ''         → NO DECLARADO. Los registros que ya existen quedan así A PROPÓSITO:
--                nadie declaró cómo se hicieron, así que el sistema no puede afirmarlo.
--                Marcarlos 'interno' en masa sería inventar un dato que nadie dio.
--                (norma: si nadie lo declaró, el documento no lo dice)
--
-- MIGRACIÓN PURAMENTE ADITIVA: agrega una columna con default ''. No toca datos ni RLS.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mantenimientos add column if not exists ejecutor text default '';

comment on column public.mantenimientos.ejecutor is
  'Quién hizo el trabajo: interno (mano de obra propia, costo 0 legítimo) | externo (taller) | vacío = no declarado (registros previos al 02/08/2026).';

-- Para el reporte «cuánto trabajo resolvimos con gente propia» y para separar el costo real
-- de flota (externo) de la mano de obra que ya está en nómina.
create index if not exists idx_mant_ejecutor on public.mantenimientos(ejecutor);

-- ── Comprobación (correr después) ───────────────────────────────────────────
--   select coalesce(nullif(ejecutor,''),'(no declarado)') as ejecutor, count(*), sum(costo_usd)
--     from public.mantenimientos group by 1 order by 2 desc;
