-- ============================================================================
-- Betangar · LA COMPRA DE DÓLARES SE VALÚA A SU TASA REAL, NO A BCV
-- 2026-08-09.
--
-- ⛔ EL ERROR QUE CORRIGE — Y QUE YA SE HABÍA COMETIDO
-- El 08/08 se convirtieron los bolívares de la compra de divisas con la tasa
-- BCV del día y dio **US$ 90.036 — un 20% de más**. Máximo lo cortó: *«la
-- compra de dólares no tienes referencia de tasa, eso te complica más»*. Quedó
-- escrito en la bitácora… y el 09/08, al construir el estado financiero, la
-- función volvió a convertir a BCV y dio **US$ 90.608**: US$ 19.489 inventados.
--
-- Un error documentado que se repite no es un descuido: es que la corrección
-- vivía en una nota y no en el dato. Por eso la tasa se GUARDA en el
-- movimiento, y el cuadro la usa. Así no depende de que alguien se acuerde.
--
-- DE DÓNDE SALEN LAS TASAS (ninguna se dedujo del BCV)
-- De la app de control que lleva Máximo y del Excel de amortización de los
-- camiones. Se comprobó dividiendo los bolívares que salieron por los dólares
-- que entraron: coinciden AL CENTAVO con lo que él anotó a mano, y las de Auto
-- Unión dan todas tasa redonda.
--
-- ✅ LA PRUEBA DE QUE ESTÁN BIEN: aplicadas una por una suman **US$ 71.119**,
-- que es exactamente el total que Máximo tiene contado por su lado, sin mirar
-- el banco. Dos registros independientes que cierran al dólar valen más que
-- cualquier deducción.
-- ============================================================================

alter table bnc_movimientos add column if not exists tasa_real      numeric;
alter table bnc_movimientos add column if not exists tasa_estimada  boolean not null default false;

comment on column bnc_movimientos.tasa_real is
  'La tasa a la que se hizo ESTA operación, cuando no es la del BCV. La compra de divisas se pacta y no tiene referencia oficial: valuarla a BCV infla el ahorro un 27%. NULL = usar la tasa BCV del día.';
comment on column bnc_movimientos.tasa_estimada is
  'true = la tasa no la declaró nadie, se dedujo. El cuadro la usa pero el número se muestra marcado: un dato deducido y uno declarado no valen igual.';

-- Las 16 compras, cada una con la tasa de SU operación.
update bnc_movimientos m set tasa_real = v.t, tasa_estimada = v.est
  from (values
    -- Found Petrol y las casas de cambio: tasas anotadas a mano por Máximo
    ('2026-04-22', 2294000.00, 620.00,   false),
    ('2026-04-22',  620000.00, 620.00,   false),
    ('2026-05-19', 2958180.00, 700.00,   false),
    ('2026-05-19',  700000.00, 700.00,   false),
    ('2026-05-29', 3000000.00, 740.01,   false),
    ('2026-06-02',12000000.00, 729.97,   false),
    ('2026-06-09', 6930000.00, 770.00,   false),
    ('2026-07-13',10250000.00, 820.00,   false),
    ('2026-07-30', 1957700.00, 851.17,   false),
    -- Auto Unión: salen de cruzar el banco contra el REGISTRO DE PAGOS del Excel
    -- de amortización. Las cinco dan tasa REDONDA, que es lo que confirma el cruce.
    ('2026-06-15', 6004000.00, 790.00,   false),
    ('2026-06-24', 1185000.00, 790.00,   false),
    ('2026-07-02',  362500.00, 725.00,   false),
    ('2026-07-21', 2580000.00, 860.00,   false),
    ('2026-07-23', 1720000.00, 860.00,   false),
    -- Carlos Castillo (V-013605857): Bs 217.500 ÷ 725 = US$ 300 exactos, y esos
    -- 300 están en el fondo como «entregados a Carlos para algo de Alejandro».
    ('2026-07-02',  217500.00, 725.00,   false),
    -- ⚠️ ATLAS, 14/04 — LA ÚNICA ESTIMADA. Máximo confirmó que fue compra de
    -- dólares «al principio» pero no cuántos. 1.260.000 ÷ 630 = 2.000 exactos, y
    -- el fondo tiene un ingreso de +$2.000 el 21/04. Se marca `tasa_estimada`:
    -- lo que sostiene el 630 es que SIN esta compra el total da 69.119 y CON ella
    -- da exactamente los 71.119 que Máximo tiene contados. Es fuerte, pero
    -- sigue siendo una deducción y el cuadro tiene que decirlo.
    ('2026-04-14', 1260000.00, 630.00,   true)
  ) as v(f, monto, t, est)
 where m.categoria = 'compra_divisas'
   and m.fecha = v.f
   and m.monto = v.monto;

-- ---------------------------------------------------------------------------
-- ⛔ EL CANDADO. Máximo (09/08): «la compra de dólares es lo único que SIEMPRE
-- tiene una tasa completamente diferente a todas las tasas que tenemos».
--
-- Por eso esta función NO cae a BCV cuando la categoría es `compra_divisas`:
-- devuelve NULL, el movimiento no se convierte, y el cuadro lo reporta como
-- pendiente. Caer a BCV «para que el número salga» es justo lo que infló el
-- ahorro un 27% dos veces seguidas.
--
-- Un cuadro al que le falta un dato y lo dice es útil. Un cuadro que rellena el
-- hueco con una tasa que no corresponde a ninguna operación real, miente — y
-- miente hacia arriba, que es la dirección peligrosa.
-- ---------------------------------------------------------------------------
create or replace function btg_tasa_mov(f date, tasa_real numeric, categoria text)
returns numeric language sql stable as $$
  select case
    -- la compra de dólares SOLO vale a su tasa pactada. Sin ella, no se valúa.
    when categoria = 'compra_divisas' then tasa_real
    else coalesce(tasa_real, (select bcv_dolar from tasas_diarias
                               where fecha <= f and bcv_dolar > 0
                               order by fecha desc limit 1))
  end
$$;

comment on function btg_tasa_mov is
  'La tasa de UN movimiento. Compra de dólares: SOLO su tasa pactada, nunca BCV (Máximo: «es lo único que siempre tiene una tasa completamente diferente»). El resto: la suya si la tiene, si no la del BCV de su día.';

-- Aviso permanente: qué compras de dólares están sin valuar. Si esto devuelve
-- filas, hay plata que el sistema no puede contar y hay que preguntar la tasa.
create or replace view v_divisas_sin_tasa
with (security_invoker = true) as
select fecha, monto bs, coalesce(concepto_banco, descripcion) concepto, control_number
  from bnc_movimientos
 where categoria = 'compra_divisas' and tasa_real is null;

comment on view v_divisas_sin_tasa is
  'Compras de dólares sin su tasa pactada. Cada fila es plata que NO se puede valuar: hay que preguntar a cuánto se compró. No se estima.';

revoke all on v_divisas_sin_tasa from anon, public;
grant select on v_divisas_sin_tasa to authenticated;
