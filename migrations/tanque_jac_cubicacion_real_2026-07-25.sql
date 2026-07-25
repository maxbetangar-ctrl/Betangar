-- tanque_jac_cubicacion_real_2026-07-25.sql   (Betangar — hrkjddehqnzcqwlkklqm)
-- Requiere: tanque_forma_origen_2026-07-25.sql
--
-- LA TABLA DEL JAC, POR FIN SACADA DEL TANQUE
--
-- Lo que había: 46 cm de altura y 13,043 L/cm parejo, que es 600 ÷ 46. Nadie midió nada.
-- Un Excel generado el 25/07 proponía 65 cm y 9,23 L/cm — la misma división con otro divisor.
--
-- Máximo mandó a medir el tanque con cinta métrica (fotos del 25/07):
--     ancho 60 cm · alto 52,5 cm · largo 199 cm
-- La forma es un PRISMA DE ESQUINAS REDONDEADAS acostado (el tanque de aluminio típico de camión),
-- ni cilindro ni cajón. Exigiendo que el volumen dé los 600 L nominales sale un radio de esquina de
-- 12,54 cm, que es exactamente lo que se ve en la foto. Tres medidas independientes reproduciendo
-- la capacidad de fábrica: eso es la verificación que faltaba.
--
-- La tabla de abajo es la integral del ancho de la sección por la altura, centímetro a centímetro:
--   ancho(y) = W - 2r + 2·raíz(r² - (r-y)²)   en las esquinas de abajo y de arriba
--   ancho(y) = W                              en el tramo recto del medio
--   litros(h) = largo · ∫ ancho(y) dy
-- Da 9,2 L/cm en el fondo, 11,94 en la panza y 8,6 arriba. La recta vieja decía 13,04 en todos lados.
--
-- QUÉ SE ARREGLA CON ESTO (todo verificado en los datos, no supuesto):
--  1. `altura_max_cm` 46 -> 52,5. A 46 cm el sistema cantaba TANQUE LLENO y en realidad faltaban
--     65 L por meter. Ningún tanque estaba lleno cuando el sistema lo decía.
--  2. Ocho mediciones reales de 47 y 50 cm (20/06 al 27/06) se habían guardado topeadas en 600 L y
--     R8 le reclamaba al chofer "esa medición está fuera de rango". Medían bien; la tabla estaba mal.
--     A partir de acá 50 cm son 577,53 L y R8 se calla.
--  3. En el tramo del medio la pendiente pasa de 13,04 a 11,94 L/cm: todos los faltantes que venía
--     calculando la auditoría estaban inflados ~10%.
--  4. La tolerancia por instrumento (2 sigmas, S(h)·σ) se recalcula sola con la nueva tabla, y ahora
--     se achica en el fondo y arriba, que es donde de verdad un centímetro vale menos.
--
-- Lo que esto NO es: un aforo con bidón. Es geometría medida sobre el tanque real, que es de otra
-- categoría que una división pero sigue siendo un cálculo. Por eso tabla_origen='calculada_de_medidas'
-- y no 'medida'. El día que se haga el aforo con volúmenes conocidos, se sobreescribe y pasa a 'medida'.
--
-- ⚠️ La MISMA tabla vive congelada en chofer.html (CL_JAC_CUB). Se actualiza en el mismo commit y se
-- bumpea CACHE_NAME del service worker, o los teléfonos siguen calculando litros con la recta vieja.

update public.combustible_tanques_config
   set altura_max_cm  = 52.5,
       forma          = 'rectangular_redondeado',
       tabla_origen   = 'calculada_de_medidas',
       tabla_cubicacion = '{"0":0,"1":8.26,"2":17.57,"3":27.5,"4":37.91,"5":48.68,"6":59.76,"7":71.08,"8":82.6,"9":94.27,"10":106.06,"11":117.93,"12":129.86,"13":141.8,"14":153.74,"15":165.68,"16":177.62,"17":189.56,"18":201.5,"19":213.44,"20":225.38,"21":237.32,"22":249.26,"23":261.2,"24":273.14,"25":285.08,"26":297.02,"27":308.96,"28":320.9,"29":332.84,"30":344.78,"31":356.72,"32":368.66,"33":380.6,"34":392.54,"35":404.48,"36":416.42,"37":428.36,"38":440.3,"39":452.24,"40":464.18,"41":476.11,"42":488.01,"43":499.85,"44":511.58,"45":523.18,"46":534.61,"47":545.81,"48":556.75,"49":567.35,"50":577.53,"51":587.18,"52":596.06}'::jsonb
 where id = 'tanque-jac';

-- Las mediciones viejas NO se tocan (norma: nunca se borra ni se reescribe una fila de la BD). El
-- `litros_calculados` guardado queda como quedó; la auditoría recalcula siempre desde la tabla, y
-- R8 es justamente la regla que avisa cuando lo guardado no coincide con la cubicación vigente.
