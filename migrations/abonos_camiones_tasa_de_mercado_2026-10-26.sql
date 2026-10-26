-- ═══════════════════════════════════════════════════════════════════════════════
-- LOS DÓLARES DE LOS CAMIONES NO SE COMPRAN AL BCV — 2026-10-26
--
-- 🔴 LA REGLA, declarada por Máximo el 26/10/2026:
--    «esos abonos a los camiones no se compran los dólares a BCV; es el único momento en que
--     se registran a una tasa diferente, que es la del mercado negro.»
--
--    Es la excepción, y hay que respetarla: en TODO lo demás la tasa es la del BCV, pero una
--    `compra_divisas` para Auto Unión se valúa a la tasa a la que se compró de verdad. Si se
--    le pone la del BCV, el sistema cree que se consiguieron MÁS dólares de los que se
--    consiguieron, y la pérdida cambiaria queda escondida.
--
-- 🔎 QUÉ SE ENCONTRÓ. Tres compras quedaron grabadas con la tasa del BCV:
--      13/10  Bs  6.030.000  tasa 876,80 → decía US$ 6.877,30   · real 1.005 → US$  6.000
--      16/10  Bs  4.950.000  tasa 880,12 → decía US$ 5.624,26   · real   990 → US$  5.000
--      24/10  Bs 14.000.000  tasa 887,30 → decía US$ 15.778,17  · real 1.000 → US$ 14.000
--    En total el sistema contaba **US$ 3.279 de dólares que nunca existieron**.
--
--    ⛔ Y LA TASA NO LA PUSE YO: cada una está declarada en una fuente independiente.
--      · 16/10 → la DESCRIPCIÓN DEL BANCO lo dice sola: «PAGO CAMION 5000DL 990T».
--      · 13/10 → la nota del abono que ya estaba en la base: «Bs 6.030.000 a Auto Union,
--        tasa 1005. El movimiento AUN NO esta en el extracto del BNC: atarlo a su compra
--        cuando entre». Ya entró: es `bnc_223004389`.
--      · 24/10 → lo declaró Máximo, y cuadra al centavo: 14.000.000 / 1.000 = 14.000.
--
-- 🔎 Y FALTABAN DOS ABONOS. El Excel «cuadro amortizacion camiones aseo .xlsx» que Máximo
--    mandó hoy por WhatsApp trae 15 pagos y US$ 140.502 abonados; la base tenía 13 y
--    US$ 121.502. Los 13 calzan uno a uno con el Excel. Faltaban exactamente el del 17/10
--    (US$ 5.000) y el del 26/10 (US$ 14.000) = los US$ 19.000 de diferencia.
--
-- ⛔ LO QUE ESTA MIGRACIÓN *NO* HACE, a propósito:
--    No toca el movimiento `bnc_223002997` del 06/10: Bs 7.425.000 a AUTO UNION DC a tasa
--    990 = US$ 7.500. Está en el banco, NO está en el Excel y NO está atado a la deuda. O el
--    Excel le falta un abono (y entonces lo abonado son US$ 148.002), o ese pago fue otra
--    cosa. Eso lo decide Máximo: inventarlo acá sería meter US$ 7.500 por mi cuenta en la
--    deuda de los camiones. [[norma-numero-que-el-dueno-no-puede-explicar]]
--
-- ⛔ REVERSIBLE: las tasas anteriores quedan guardadas en `configuracion`, clave
--    `backup_tasas_compra_divisas_2026-10-26`. El UNDO está al final.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Respaldo ANTES de tocar nada ────────────────────────────────────────────────
insert into public.configuracion (clave, valor)
select 'backup_tasas_compra_divisas_2026-10-26',
       coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'fecha', m.fecha, 'monto', m.monto, 'tasa_real', m.tasa_real) order by m.id)::text, '[]')
  from public.bnc_movimientos m
 where m.id in ('bnc_223004389','bnc_192040598','bnc_180003833')
on conflict (clave) do nothing;

-- ── 1) Las tres tasas, a la de mercado ──────────────────────────────────────────
update public.bnc_movimientos set tasa_real = 1005 where id = 'bnc_223004389';  -- 6.030.000 /1005 = 6.000
update public.bnc_movimientos set tasa_real =  990 where id = 'bnc_192040598';  -- 4.950.000 / 990 = 5.000
update public.bnc_movimientos set tasa_real = 1000 where id = 'bnc_180003833';  -- 14.000.000/1000 = 14.000

-- ── 2) El abono del 13/10 ya existía «sin declarar»: se ata a su compra ─────────
update public.deuda_abonos
   set mov_id = 'bnc_223004389',
       origen = 'compra_divisas',
       nota   = coalesce(nota,'') || ' | 26/10/2026: atado a bnc_223004389 (el movimiento ya entro al extracto) y la tasa del movimiento corregida a 1005.'
 where deuda_id = 1 and fecha = '2026-10-13' and monto = 6000 and mov_id is null;

-- ── 3) Los dos abonos que faltaban ──────────────────────────────────────────────
-- La fecha es la del EXCEL (como los demas abonos cargados de ahi) y la del banco va en la
-- nota: son distintas porque el extracto trae el dia en que salio la plata.
insert into public.deuda_abonos (deuda_id, fecha, monto, origen, mov_id, nota)
select 1, '2026-10-17'::date, 5000, 'compra_divisas', 'bnc_192040598',
       'Excel «cuadro amortizacion camiones aseo .xlsx» del 26/10/2026 (WhatsApp). Bs 4.950.000 a tasa 990 — la tasa la dice la descripcion del banco: «PAGO CAMION 5000DL 990T». Movimiento BNC del 16/10.'
 where not exists (select 1 from public.deuda_abonos where mov_id = 'bnc_192040598');

insert into public.deuda_abonos (deuda_id, fecha, monto, origen, mov_id, nota)
select 1, '2026-10-26'::date, 14000, 'compra_divisas', 'bnc_180003833',
       'Excel «cuadro amortizacion camiones aseo .xlsx» del 26/10/2026 (WhatsApp). Bs 14.000.000 a tasa 1000, declarada por Maximo. Movimiento BNC del 24/10 «TRANSFERENCIA A FAVOR DE: AUTO UNION DC».'
 where not exists (select 1 from public.deuda_abonos where mov_id = 'bnc_180003833');

-- ── CONTROLES: si alguno falla, no queda nada a medias ──────────────────────────
do $$
declare n int; t numeric; s numeric;
begin
  -- a) Las tres tasas quedaron puestas.
  select count(*) into n from public.bnc_movimientos
   where id in ('bnc_223004389','bnc_192040598','bnc_180003833')
     and tasa_real in (1005, 990, 1000);
  if n <> 3 then raise exception 'Las tasas no quedaron las 3 corregidas (hay %)', n; end if;

  -- b) Cada una da un monto REDONDO en dolares: es la prueba de que la tasa es la correcta.
  select count(*) into n from public.bnc_movimientos
   where id in ('bnc_223004389','bnc_192040598','bnc_180003833')
     and abs(round(monto/tasa_real) - monto/tasa_real) > 0.01;
  if n > 0 then raise exception '% compras no dan un monto redondo en USD: la tasa no es la real', n; end if;

  -- c) CONTROL POSITIVO contra el Excel: 15 abonos y US$ 140.502 abonados.
  select count(*), sum(monto) into n, t from public.deuda_abonos where deuda_id = 1;
  if n <> 15 then raise exception 'Quedaron % abonos, el Excel tiene 15', n; end if;
  if abs(t - 140502) > 1 then raise exception 'Total abonado US$ %, el Excel dice 140.502', round(t,2); end if;

  -- d) Y el saldo tiene que cuadrar con el Excel: 421.507,92 a pagar - 140.502 = 281.005,92
  select 421507.9150523227 - t into s;
  if abs(s - 281005.9150523227) > 1 then raise exception 'El saldo pendiente da US$ % y el Excel dice 281.005,92', round(s,2); end if;

  -- e) El respaldo tiene que existir: sin el, esto no se puede deshacer.
  if not exists (select 1 from public.configuracion
                  where clave = 'backup_tasas_compra_divisas_2026-10-26' and valor <> '[]') then
    raise exception 'No se escribio el respaldo de tasas: se aborta';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO:
--   update public.bnc_movimientos m
--      set tasa_real = (b.v->>'tasa_real')::numeric
--     from (select jsonb_array_elements(valor::jsonb) v from public.configuracion
--            where clave='backup_tasas_compra_divisas_2026-10-26') b
--    where m.id = b.v->>'id';
--   delete from public.deuda_abonos where mov_id in ('bnc_192040598','bnc_180003833');
--   update public.deuda_abonos set mov_id=null, origen='sin_declarar'
--    where deuda_id=1 and fecha='2026-10-13' and monto=6000;
-- ═══════════════════════════════════════════════════════════════════════════════
