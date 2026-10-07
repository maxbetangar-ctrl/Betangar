-- ═══════════════════════════════════════════════════════════════════════════════
-- EL RECORRIDO DE LA REGLA ES UNA MEDICIÓN APARTE, Y AHORA SE DECLARA
--
-- 🔴 POR QUÉ. `alto_cm` es qué tan PROFUNDO es el tanque (sirve para el VOLUMEN) y
--    `altura_max_cm` es cuánto RECORRE LA REGLA (sirve para LEER la medición). Son dos
--    mediciones distintas, de dos personas distintas y con dos instrumentos distintos:
--    el aforador tiene la cinta, el chofer tiene la regla. Las columnas YA existían y YA
--    funcionaban —medido el 07/10: en 11 de los 17 tanques de FLOTILLA están
--    correctamente distintas (FC01 53/67 · FC03 y FC04 22/43,5 · FC06 33/36)— porque
--    cuando la tabla viene de la hoja de aforo del cliente, ya está indexada por la regla.
--
-- ⛔ LO QUE LAS ROMPÍA ERA UN SOLO CAMINO DE ESCRITURA: `tqGuardar()` hacía
--    `altura_max_cm: alto` dentro de un **upsert de la fila entera**, así que un re-aforo
--    por geometría PISABA un recorrido de regla que podía estar perfecto — y pisaba
--    también `tabla_origen`, que era el único rastro de que había habido tabla del cliente.
--    🔴 Eso es exactamente lo que le pasó al FC17 el 05/10 21:05 VE: tenía 48 y quedó en
--    27. Dos días de un chofer peleando con la pantalla, 150 L cantados donde había 75, y
--    la auditoría de esa unidad sin un solo litro durante 48 h.
--
-- ✅ ESTA MIGRACIÓN NO CAMBIA NINGÚN NÚMERO. Solo agrega una columna que DICE de dónde
--    salió el recorrido de la regla, para que el código pueda distinguir «alguien lo midió»
--    de «nadie lo midió y se supuso igual al alto». Hasta hoy eso se suponía en silencio, y
--    un default que no se declara no se puede defender ni discutir.
--    [[norma-default-en-campo-que-se-declara]]
--
--    Valores, y qué significa cada uno:
--      'medido_con_la_regla'    → alguien metió la regla en el tanque lleno y lo anotó
--      'tabla_del_cliente'      → vino en la hoja de aforo del cliente, ya indexada por regla
--      'historial_del_chofer'   → se reconstruyó de lo que la regla venía marcando (FC17)
--      'supuesto_igual_al_alto' → NADIE lo midió: se asumió que la regla recorre el alto
--
-- ⚠️ El relleno NO adivina: se deduce de lo que ya está escrito en la fila
--    (`tabla_origen` y si `altura_max_cm` coincide o no con el alto geométrico), que es el
--    único rastro que hay. Lo que quede en 'supuesto_igual_al_alto' es precisamente la
--    lista de tanques donde nadie midió la regla — y es la lista que hay que ir a medir.
--
-- ⛔ LO QUE NO ARREGLA: FC13 y FC14 (FORD CARGO, 27/27, 150 L) van a quedar en
--    'supuesto_igual_al_alto', que es la verdad — pero su recorrido real sigue sin medirse,
--    y las tres (con FC17) se aforaron el 06/10 con las MISMAS medidas 51 × 27 × 109.
--    Eso lo resuelve una persona con una regla, no una migración.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.combustible_tanques_config add column if not exists regla_origen text;

comment on column public.combustible_tanques_config.regla_origen is 'De dónde salió altura_max_cm (el RECORRIDO DE LA REGLA, que NO es alto_cm): medido_con_la_regla | tabla_del_cliente | historial_del_chofer | supuesto_igual_al_alto. Un aforo por geometría NO puede pisar altura_max_cm salvo que acá diga supuesto_igual_al_alto.';

update public.combustible_tanques_config set regla_origen = case when altura_max_cm is null then null when coalesce(tabla_origen,'') ilike '%historial%' or coalesce(tabla_origen,'') ilike 'regla_%' then 'historial_del_chofer' when coalesce(tabla_origen,'') in ('tabla_del_cliente','declarada_por_el_cliente') then 'tabla_del_cliente' when coalesce(alto_cm, diametro_cm) is null then 'tabla_del_cliente' when altura_max_cm = coalesce(alto_cm, diametro_cm) then 'supuesto_igual_al_alto' else 'medido_con_la_regla' end where regla_origen is null;
