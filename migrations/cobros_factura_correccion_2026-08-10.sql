-- ═══════════════════════════════════════════════════════════════════════════
-- COBROS DE FACTURA: las 2 patas que el supervisor escribió mal, y la que faltaba
-- Betangar — hrkjddehqnzcqwlkklqm — 2026-08-10
-- ═══════════════════════════════════════════════════════════════════════════
-- Qué estaba mal en `cobros_factura` (36 patas, 2 equivocadas y 1 ausente):
--
--   000637-fiel  guardaba la referencia y el monto EXACTOS del 000632-fiel
--                (ref 10263522741784, 24/06, Bs 1.308.798,35). El mismo depósito
--                contado dos veces. El real es del 28/07 por Bs 1.262.627,58.
--   000638-fiel  apuntaba a un TRASPASO ENTRE CUENTAS PROPIAS del 22/07
--                (Bs 1.946.290,40, ref 145545836) para una factura del 05/08.
--                Ese cobro NO ha entrado: son los US$ 2.535,04 que la Alcaldía
--                sigue debiendo. La fila se borra y NO se repone.
--   000636-fiel  no existía, y sí se cobró: 22/07, Bs 1.764.019,66,
--                ref 11452226286366.
--
-- Las dos que se reponen NO se teclean: salen de `bnc_movimientos`, que es donde
-- el estado de cuenta ya está clasificado y es lo que lee `v_cobro_facturas`.
-- Así las dos fuentes quedan diciendo lo mismo por construcción, que es
-- justamente lo que falló: el error vivió dos semanas en `cobros_factura` sin
-- verse en pantalla, porque la pantalla lee la otra tabla.
--
-- La causa de que se escribieran así queda cerrada en la Edge Function
-- `cobros-alcaldia` (mismo día): un movimiento ya cobrado por otra factura ya no
-- se vuelve a ofrecer, solo compiten los créditos `categoria='cobro_alcaldia'`,
-- y un cobro no puede ser anterior a la factura que paga.

begin;

-- ── 1) RESPALDO ANTES DE TOCAR NADA ────────────────────────────────────────
-- La tabla entera, no solo las filas afectadas: si el criterio de abajo estuviera
-- mal, con las 3 filas sueltas no se puede reconstruir el estado anterior.
insert into public.configuracion(clave, valor)
select 'backup_cobros_factura_2026-08-10', coalesce(jsonb_agg(to_jsonb(c))::text, '[]')
  from public.cobros_factura c
on conflict (clave) do update set valor = excluded.valor;

-- ── 2) COMPROBAR QUE EL RESPALDO TRAJO ALGO ────────────────────────────────
-- Un respaldo que "existe" y está vacío es peor que no tenerlo: da permiso para
-- borrar. Si no llegan las 30 filas, esto REVIENTA y el commit no ocurre.
do $$
declare n int;
begin
  select jsonb_array_length(valor::jsonb) into n
    from public.configuracion where clave = 'backup_cobros_factura_2026-08-10';
  if coalesce(n, 0) < 30 then
    raise exception 'El respaldo salió con % filas. No se borra nada.', coalesce(n, 0);
  end if;
  raise notice 'Respaldo verificado: % filas.', n;
end $$;

-- ── 3) FUERA LAS DOS MALAS ─────────────────────────────────────────────────
delete from public.cobros_factura where id in ('000637-fiel', '000638-fiel');

-- ── 4) REPONER DESDE EL ESTADO DE CUENTA (no a mano) ───────────────────────
-- Solo las patas que el cruce del 09/08 ya dejó selladas en `bnc_movimientos`.
-- 000638-fiel no está sellada ahí — por eso no se repone: no se ha cobrado.
insert into public.cobros_factura(id, fact, pata, fecha, banco, referencia, monto_bs, obs, creado_por)
select m.factura || '-' || m.pata, m.factura, m.pata, m.fecha::date, 'BNC',
       m.referencia, m.monto,
       'Repuesto del estado de cuenta (correccion 10/08): ' ||
         left(coalesce(nullif(m.concepto_banco, ''), m.descripcion, ''), 200),
       'correccion-2026-08-10'
  from public.bnc_movimientos m
 where m.factura in ('000636', '000637')
   and m.pata = 'fiel'
   and m.tipo = 'credito'
on conflict (id) do update
   set fecha = excluded.fecha, banco = excluded.banco, referencia = excluded.referencia,
       monto_bs = excluded.monto_bs, obs = excluded.obs, creado_por = excluded.creado_por;

-- ── 5) COMPROBAR EL RESULTADO ANTES DE CERRAR ──────────────────────────────
-- (a) las dos tablas tienen que decir lo mismo, pata por pata;
-- (b) ninguna referencia+monto puede estar cobrada por dos facturas distintas.
do $$
declare d int; r int;
begin
  select count(*) into d
    from public.cobros_factura c
    full join (select factura, pata, fecha, monto, referencia
                 from public.bnc_movimientos where factura is not null and pata is not null) m
      on m.factura = c.fact and m.pata = c.pata
   where c.id is null or m.factura is null
      or round(c.monto_bs, 2) <> round(m.monto, 2)
      or c.fecha <> m.fecha::date;
  if d > 0 then
    raise exception 'Quedan % patas donde cobros_factura y bnc_movimientos no coinciden.', d;
  end if;

  select count(*) into r from (
    select referencia, monto_bs from public.cobros_factura
     where coalesce(referencia, '') <> ''
     group by referencia, monto_bs having count(*) > 1) x;
  if r > 0 then
    raise exception 'Hay % depositos cobrados por mas de una factura.', r;
  end if;
  raise notice 'Las dos fuentes coinciden y no hay depositos repetidos.';
end $$;

commit;
