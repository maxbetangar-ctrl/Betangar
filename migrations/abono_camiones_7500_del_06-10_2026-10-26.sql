-- ═══════════════════════════════════════════════════════════════════════════════
-- EL ABONO DE US$ 7.500 DEL 06/10 QUE EL EXCEL NO TIENE — 2026-10-26
--
-- 🔎 CÓMO APARECIÓ. Reconciliando la deuda de los camiones contra el Excel
--    «cuadro amortizacion camiones aseo .xlsx» quedó un movimiento del banco que el Excel no
--    registra: `bnc_223002997`, 06/10/2026, Bs 7.425.000 a AUTO UNION DC a tasa 990 =
--    **US$ 7.500 exactos**. No se toco en su momento porque meterlo por cuenta propia era
--    inventar US$ 7.500 en la deuda. Se le pregunto a Maximo y respondio: «si fue abono a
--    camiones». [[norma-numero-que-el-dueno-no-puede-explicar]]
--
--    ⛔ La tasa de ese movimiento NO se toca: ya estaba en 990, la de mercado, y da un monto
--      redondo (7.425.000 / 990 = 7.500). Es de las que estaban bien.
--
-- 📌 LA FECHA ES LA DEL BANCO. Los demas abonos llevan la fecha del Excel porque de ahi
--    salieron; este NO esta en el Excel, asi que la unica fecha que existe es la del extracto.
--
-- ⚠️ CONSECUENCIA: el Excel queda DESACTUALIZADO. Lo abonado pasa de US$ 140.502 a
--    **US$ 148.002** y el saldo de US$ 281.005,92 a **US$ 273.505,92**. El Excel es el papel
--    que Maximo comparte, asi que hay que corregirlo alla tambien o las dos fuentes van a
--    discrepar en 7.500. [[norma-correccion-heredada-toca-todas-las-tablas]]
-- ═══════════════════════════════════════════════════════════════════════════════

insert into public.deuda_abonos (deuda_id, fecha, monto, origen, mov_id, nota)
select 1, '2026-10-06'::date, 7500, 'compra_divisas', 'bnc_223002997',
       'Bs 7.425.000 a tasa 990 = US$ 7.500 exactos. Movimiento del banco «TRANSFERENCIA A FAVOR DE: AUTO UNION DC». NO esta en el Excel del 26/10/2026 (que llega a 140.502): lo confirmo Maximo el 26/10 — «si fue abono a camiones». La fecha es la del extracto porque es la unica que existe para este pago.'
 where not exists (select 1 from public.deuda_abonos where mov_id = 'bnc_223002997');

-- ── CONTROLES ───────────────────────────────────────────────────────────────────
do $$
declare n int; t numeric;
begin
  select count(*), sum(monto) into n, t from public.deuda_abonos where deuda_id = 1;
  if n <> 16 then raise exception 'Quedaron % abonos, se esperaban 16', n; end if;
  if abs(t - 148002) > 1 then raise exception 'Total abonado US$ %, se esperaba 148.002', round(t,2); end if;
  -- Que el movimiento siga dando un monto redondo: si alguien le cambia la tasa, se nota.
  if not exists (select 1 from public.bnc_movimientos
                  where id='bnc_223002997' and abs(round(monto/tasa_real) - monto/tasa_real) < 0.01) then
    raise exception 'bnc_223002997 no da un monto redondo en USD: revisar su tasa';
  end if;
  -- Y que NINGUN abono quede sin su movimiento del banco, salvo los dos que nunca lo tuvieron
  -- (15/06 y 18/08, «vienen de cuenta de los castillo»).
  select count(*) into n from public.deuda_abonos
   where deuda_id=1 and mov_id is null and fecha not in ('2026-06-15','2026-08-18');
  if n > 0 then raise exception '% abonos quedaron sin movimiento del banco atado', n; end if;
end $$;

-- UNDO:  delete from public.deuda_abonos where mov_id = 'bnc_223002997';
