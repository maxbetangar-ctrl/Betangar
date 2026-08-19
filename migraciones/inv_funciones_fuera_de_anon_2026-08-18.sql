-- ============================================================================
-- `inv_recalcular_saldo` E `inv_nombre_norm` SALEN DE `anon`  ·  18/08/2026
--
-- Apareció haciendo la pasada de seguridad a TONY GAS (base nueva, cliente que
-- paga desde el 13/08 y que **nunca se había auditado**). No es de TONY GAS:
-- viene del MOLDE y está igual en Betangar, Flotilla, VIDECA y la DEMO.
--
-- 🔴 QUÉ ES. `inv_recalcular_saldo(p_item text)` es SECURITY DEFINER, suma los
--    movimientos del ítem, **ESCRIBE** `inventario.stock` y **DEVUELVE** el
--    saldo. Y `anon` puede llamarla por PostgREST.
--
-- ✅ COMPROBADO EXPLOTABLE, y sin alterar nada: se llamó SIN SESIÓN contra un
--    ítem real de Betangar → HTTP 200, devolvió el stock. Se midió el valor
--    antes y después: idéntico (1 → 1), porque la función recalcula desde los
--    movimientos y escribe lo mismo que el motor ya mantiene.
--
-- ⛔ Y EL ID ES ENUMERABLE: `INV` + marca de tiempo en milisegundos
--    (`INV1783615484801`). Un rango de fechas es un espacio de búsqueda chico:
--    se puede recorrer el inventario entero de la empresa. Misma familia que el
--    recibo correlativo que se cerró hoy en MaxStock.
--
-- ⛔ NADIE LA LLAMA COMO `anon`. Cero referencias en los 4 repos (Betangar,
--    flotilla-app, videca-app, flotamax-demo). Dentro de la base la llama UNA
--    sola cosa: `inv_saldo_trg`, un DISPARADOR y además SECURITY DEFINER, que
--    corre como su dueño — revocarle a `anon` no lo toca. Verificado antes de
--    escribir esto: revocar acá no apaga el recálculo del inventario.
--
-- ⚠️ SE REVOCA TAMBIÉN DE `public`, y esto no es por las dudas. El propio prompt
--    de la auditoría lo dejó escrito: «REVOKE EXECUTE ... FROM anon es un NO-OP
--    SILENCIOSO cuando el permiso no vino de un grant directo a anon sino del
--    default de Postgres que da EXECUTE a PUBLIC». Revocar solo de `anon` habría
--    devuelto «listo» sin cerrar nada.
-- ============================================================================

revoke all on function public.inv_recalcular_saldo(text) from anon, public;
revoke all on function public.inv_nombre_norm(text)      from anon, public;

-- `authenticated` la conserva: la oficina sí puede recalcular su inventario.
grant execute on function public.inv_recalcular_saldo(text) to authenticated;
grant execute on function public.inv_nombre_norm(text)      to authenticated;

comment on function public.inv_recalcular_saldo(text) is
  'Recalcula el stock de un ítem desde sus movimientos. ⛔ NO para `anon`: es SECURITY '
  'DEFINER, devuelve el saldo y escribe en `inventario`, y el id es enumerable '
  '(INV+timestamp). Se revocó el 18/08/2026 de anon y de public. La usa el disparador '
  '`inv_saldo_trg`, que corre como su dueño y no depende de este permiso.';
