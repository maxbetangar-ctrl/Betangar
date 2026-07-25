-- ════════════════════════════════════════════════════════════════════════════
-- TOPE DE LITROS POR SURTIDA   2026-07-25
--
-- CAUSA (pasó en FLOTILLA, unidad FC09 placa A13BW6V): el chofer escribió "25.115"
-- litros, el <input type="number"> se comió el punto y se guardaron 25.115 L
-- valuados en $20.092,00 en un camión que carga ~250 L. La RPC solo validaba > 0.
--
-- ARREGLO (va a TODAS las apps de flota, norma de sincronización):
--  1. Tope duro server-side. El tope vive en UN SOLO LUGAR:
--     configuracion.clave='surtida_litros_max' (default 2000).
--  2. Al pasarse LANZA error (no devuelve null en silencio: el chofer veía
--     "✅ registrada" sin que se hubiera guardado nada).
-- En el chofer, además, los miles se ponen solos mientras se escribe.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.configuracion (clave, valor)
select 'surtida_litros_max', '2000'
where not exists (select 1 from public.configuracion where clave='surtida_litros_max');

-- El cuerpo de surtida_registrar es PROPIO de cada app (tanques y costeo distintos):
-- lo aplicado fue injertar, justo después de `if v_lit <= 0 then return null; end if;`:
--
--   v_max := coalesce((select nullif(trim(valor),'')::numeric from public.configuracion
--                      where clave='surtida_litros_max' limit 1), 2000);
--   if v_lit > v_max then
--     raise exception 'Litros invalidos: % L supera el maximo por surtida (% L). Revisa el tipeo.', v_lit, v_max;
--   end if;
--
-- (declarando `v_max numeric;`). Verificado en las 4 bases: 25115 L se rechaza, 251,51 L entra.
