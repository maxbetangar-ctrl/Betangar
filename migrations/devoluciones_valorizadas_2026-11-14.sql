-- ═══════════════════════════════════════════════════════════════════════════════
-- LA DEVOLUCIÓN ES UNA REVERSIÓN, NO UN HECHO NUEVO: hay que valorizarla
--
-- 🔴 POR QUÉ. Máximo, 14/11/2026: «si ese combustible ya se pagó cuando se les puso a
--    los camiones, al sacarlo y ponerlo en el tanque no debería aumentar la cuenta por
--    pagar ¿o sí?». No — y el problema no es la CxP (esa nunca se tocó), es la
--    ATRIBUCIÓN: las 10 unidades que entregaron gasoil el 10/11 están cargando
--    **US$ 847,85** de combustible que no quemaron, y el camión que lo reciba después
--    lo va a pagar otra vez.
--
-- ⛔ MOVER COMBUSTIBLE NO CREA NI DESTRUYE GASTO. El gasto ocurre cuando se QUEMA. El
--    tanque de un camión no es un gasto: es un depósito. Por eso la devolución se
--    acredita a la unidad que la entregó, al precio que ESA unidad pagó, y el tanque la
--    recibe valorizada al mismo precio. Total de la empresa: sin cambio.
--
-- 📌 EL PRECIO NO SE TECLEA, SE DERIVA. Sale del promedio ponderado de lo que esa unidad
--    cargó en las 6 semanas previas (`sum(costo_usd)/sum(litros)` de sus surtidas). Un
--    número escrito a mano acá sería un dato inventado con cara de medido, y encima
--    irreproducible. [[norma-un-monto-que-encaja-puede-estar-mal]]
--
-- ⚠️ Y SE CONGELA. Una vez calculado se guarda: el costo de un hecho de noviembre no
--    puede moverse porque en diciembre cambie el precio del gasoil.
--    [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.devoluciones_tanque
  add column if not exists costo_litro_usd numeric,
  add column if not exists costo_usd       numeric,
  add column if not exists costo_origen    text;

comment on column public.devoluciones_tanque.costo_litro_usd is
  'US$/L al que se le acredita a la unidad. Derivado de sus propias surtidas, no tecleado.';
comment on column public.devoluciones_tanque.costo_usd is
  'Valor del combustible devuelto. Se le RESTA a la unidad (no lo quemó) y entra con ese valor al tanque. No toca la CxP: ya estaba pagado.';
comment on column public.devoluciones_tanque.costo_origen is
  'De dónde salió el $/L, para poder rehacer la cuenta años después.';

-- Valorización de las 10 filas del 10/11, derivada de las surtidas de cada unidad.
with costo as (
  select cam,
         sum(costo_usd::numeric) / nullif(sum(litros::numeric), 0) as cl
    from public.surtidas
   where fecha between '2026-10-01' and '2026-11-10'
     and costo_usd is not null
     and litros::numeric > 0
   group by cam
)
update public.devoluciones_tanque d
   set costo_litro_usd = round(c.cl, 4),
       costo_usd       = round(d.litros * c.cl, 2),
       costo_origen    = 'promedio ponderado de las surtidas de la unidad, 01/10 al 10/11'
  from costo c
 where c.cam = d.cam
   and d.fecha = '2026-11-10'
   and d.costo_usd is null;

-- ⛔ CONTROL: si alguna fila quedó sin valorizar hay que saberlo, no descubrirlo en un
--    informe. Una unidad sin surtidas en la ventana no tiene de dónde sacar el precio.
do $$
declare n int;
begin
  select count(*) into n from public.devoluciones_tanque
   where fecha = '2026-11-10' and costo_usd is null;
  if n > 0 then
    raise warning 'quedaron % devoluciones SIN valorizar: no tienen surtidas en la ventana', n;
  end if;
end $$;
