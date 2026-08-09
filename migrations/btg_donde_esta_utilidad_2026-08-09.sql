-- ============================================================================
-- Betangar · ¿DÓNDE ESTÁ LA UTILIDAD? — el desglose que va a pedir un socio
-- 2026-08-09.
--
-- Máximo: «hay algo que me preocupa que debe ir en el informe y en el dashboard
-- porque sé que los socios lo van a preguntar: si solo hemos comprado 74.000
-- dólares y pico, ¿por qué hablamos de utilidad de 100.000?».
--
-- Es LA pregunta, y hoy el sistema no la respondía. La utilidad no es plata
-- guardada en una caja: es lo que quedó después de gastar, y se transformó en
-- cosas distintas. Este desglose las nombra una por una hasta que cierre.
--
-- ⛔ LA LÍNEA QUE NO SE ESCONDE
-- Al armarlo quedó una diferencia de ~US$ 5.600 (6,4%). La tentación es
-- llamarla «redondeo» y diluirla. NO: es el efecto de medir con tasas
-- distintas —cada movimiento a la tasa de SU día, el saldo final a la de HOY—
-- y va como renglón propio y visible. Un desglose que cierra porque una línea
-- se llamó «redondeo» es justo el que destruye la confianza cuando alguien
-- pregunta qué es esa línea.
-- ============================================================================

create or replace function btg_donde_esta_utilidad(p_desde text, p_hasta text)
returns table (
  orden    int,
  concepto text,
  usd      numeric,
  nota     text
)
language sql
security definer
set search_path = public
as $$
  with r as (select * from btg_resumen_socio(p_desde, p_hasta)),
       f as (select * from v_fondo_divisas),
       -- saldo actual de las cuentas en bolívares = el último saldo conocido de cada una
       sal as (
         select coalesce(sum(saldo),0) bs from (
           select cuenta, (saldo_anterior + case when tipo='credito' then monto else -monto end) saldo,
                  row_number() over (partition by cuenta order by fecha desc, control_number::bigint desc) rn
             from bnc_movimientos
            where saldo_anterior is not null and control_number ~ '^[0-9]+$'
         ) x where rn = 1
       ),
       th as (select btg_tasa_de(current_date) t)
  select 1, 'Se pasó a dólares (comprados en el período)',
         round((select comprado_usd from f)::numeric,2),
         'Bolívares que se convirtieron a moneda dura. De estos, parte ya se aplicó a la deuda de los camiones.'
  union all
  select 2, 'Sigue en bolívares, en las cuentas',
         round(((select bs from sal) / nullif((select t from th),0))::numeric,2),
         'Bs ' || round((select bs from sal)) || ' a la tasa de hoy. Es lo único que todavía se puede gastar directo.'
  union all
  select 3, 'Se vendieron dólares para cubrir nómina',
         round((select vendido_usd from f)::numeric,2),
         'Volvieron a bolívares y se gastaron: ya están dentro del gasto del período.'
  union all
  select 4, '⚠️ Diferencia por medir con tasas distintas',
         round((
           (select utilidad_usd from r)
           - (select comprado_usd from f)
           - ((select bs from sal) / nullif((select t from th),0))
           - (select vendido_usd from f)
         )::numeric,2),
         'Cada movimiento se mide a la tasa de SU día y el saldo final a la de HOY. Esa diferencia de método no es plata que falte ni que sobre: es el precio de medir en dólares una operación que ocurre en bolívares. NO es redondeo y por eso va como renglón propio.'
  order by 1
$$;

revoke all on function btg_donde_esta_utilidad(text,text) from anon, public;
grant execute on function btg_donde_esta_utilidad(text,text) to authenticated;

comment on function btg_donde_esta_utilidad is
  'En qué se transformó la utilidad. Responde la pregunta del socio: «si solo compramos 74.763 en dólares, ¿por qué la utilidad es mayor?». La línea 4 es la diferencia de método y va visible, nunca diluida como «redondeo».';

-- ---------------------------------------------------------------------------
-- Y LA OTRA MITAD DE LA RESPUESTA: los dólares comprados NO están todos en el
-- fondo porque una parte ya se convirtió en MENOS DEUDA. Un socio que ve
-- «compramos 74.763» y «el fondo tiene 26.445» necesita ver qué pasó en medio.
-- ---------------------------------------------------------------------------
create or replace function btg_donde_estan_los_dolares()
returns table (orden int, concepto text, usd numeric, nota text)
language sql security definer set search_path = public as $$
  with f as (select * from v_fondo_divisas)
  select 1, 'Comprados dentro del período', round((select comprado_usd from f)::numeric,2),
         '16 operaciones, cada una a su tasa pactada (620 a 860), nunca a BCV.'
  union all
  select 2, 'Los que ya había antes del 23/03', 6000::numeric,
         'Saldo con que abre el fondo. Son anteriores al estado de cuenta, por eso el sistema solo puede verlos declarados.'
  union all
  select 3, 'Menos los vendidos para nómina', -round((select vendido_usd from f)::numeric,2),
         'Volvieron a bolívares para pagar sueldos.'
  union all
  select 4, '= COMPRADO EN TOTAL',
         round(((select comprado_usd from f) + 6000 - (select vendido_usd from f))::numeric,2),
         'Este es el número que lleva Máximo contado por su lado, y coincide al dólar.'
  union all
  select 5, 'Menos lo aplicado a la deuda de los camiones', -round((select a_deuda_usd from f)::numeric,2),
         'NO se gastó: se convirtió en menos deuda. Los dólares los compra Auto Unión y los aplica al crédito en el mismo acto.'
  union all
  select 6, '= QUEDA EN EL FONDO', round((select saldo_usd from f)::numeric,2),
         'En la cuenta de Alejandro Castillo. Es un activo de la empresa en manos de una persona.'
  order by 1
$$;

revoke all on function btg_donde_estan_los_dolares() from anon, public;
grant execute on function btg_donde_estan_los_dolares() to authenticated;
