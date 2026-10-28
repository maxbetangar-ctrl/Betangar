-- ════════════════════════════════════════════════════════════════════════════════════════════
-- EL MEMBRETE DEL INFORME — Betangar · 28/10/2026
--
-- 🔬 POR QUÉ. Máximo, al ver el primer resumen: «no tiene ni el logo de Betangar ni mi firma, y
--    que esté llenado como si yo lo hubiese escrito».
--
-- 📌 VA EN LA CONFIGURACIÓN, NO EN EL CÓDIGO. Cambiar el logo, el firmante o su cargo no puede
--    exigir un despliegue — y así la firma MANUSCRITA se puede pegar el día que exista, sin
--    tocar nada. [[norma-arreglar-el-mecanismo-no-el-caso]]
--
-- ⛔ `firma_png_b64` NACE VACÍA Y ESO ES A PROPÓSITO. Mientras lo esté, el informe dibuja la
--    línea de firma con el nombre y el cargo debajo, que es un bloque de firma válido. NO se
--    inventa una firma manuscrita en un documento financiero.
--    [[norma-documento-no-afirma-lo-que-nadie-declaro]]
--
-- ⛔ EL VALOR REAL NO ESTÁ EN ESTE ARCHIVO: el logo son ~41 KB de base64 y meterlos acá haría
--    una migración ilegible. Lo carga `maxware-tools` leyendo `Betangar/logo.png`, que es la
--    fuente. Esta migración solo deja la fila con su forma y su documentación.
--
-- Para reemplazar el logo:  cambiar `Betangar/logo.png` y volver a cargarlo.
-- Para pegar la firma:      update configuracion set valor = jsonb_set(valor::jsonb,
--                             '{firma_png_b64}', to_jsonb('<base64 del PNG>'::text))::text
--                           where clave = 'informe_membrete';
-- ════════════════════════════════════════════════════════════════════════════════════════════

insert into configuracion (clave, valor)
values ('informe_membrete', '{"logo_png_b64":null,"firmante":"Máximo Alberto Betancourt García","cargo":"Gerente General","firma_png_b64":null}')
on conflict (clave) do nothing;   -- ⛔ `do nothing`: si ya tiene el logo cargado, no se pisa con nulos
