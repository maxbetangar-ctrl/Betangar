-- ═══════════════════════════════════════════════════════════════════════════
-- LA RAZÓN SOCIAL FISCAL DEL PROVEEDOR — 02/11/2026
--
-- ⛔ EL NOMBRE CON EL QUE LA CASA LLAMA A UN PROVEEDOR NO ES SU RAZÓN SOCIAL.
--    `proveedores.nombre` lleva anotaciones de uso interno —«(ATLAS)»,
--    «(E/S PALOTAL)», «(COPERCA)»— que sirven para encontrarlo en una lista y
--    NO pueden salir en un comprobante fiscal. Medido contra los comprobantes
--    que Betangar ya emitió: ninguno trae la coletilla.
--
--      sistema                      comprobante real
--      HUMBERTO PACCINI (ATLAS)  →  CAUCHERA SR. PACCINI
--      INCONSUMMCA, C.A. (ATLAS) →  INCONSUMMCA, C.A
--
-- Por eso el nombre fiscal se GUARDA, no se deduce: deducirlo quitando los
-- paréntesis acierta en los dos de arriba y en el resto es una apuesta.
-- ═══════════════════════════════════════════════════════════════════════════

alter table proveedores add column if not exists razon_social text;

comment on column proveedores.razon_social is
  'Razón social EXACTA para los comprobantes fiscales. `nombre` es el de uso interno y puede llevar coletillas entre paréntesis. Si está vacía, el emisor deriva una quitando la coletilla y la muestra para que la persona la confirme.';

-- Se siembra SÓLO con lo leído de comprobantes reales ya emitidos, que es la
-- única fuente que no es una suposición. Lo que no esté acá queda en blanco a
-- propósito. [[norma-respaldo-que-inventa-un-dato]]
update proveedores set razon_social = 'AUTO UNION DC, C.A'
 where nombre = 'AUTO UNION DC, C.A.' and coalesce(razon_social,'') = '';

update proveedores set razon_social = 'INCONSUMMCA, C.A'
 where nombre = 'INCONSUMMCA, C.A. (ATLAS)' and coalesce(razon_social,'') = '';

update proveedores set razon_social = 'SOLUCIONES DE LOCALIZACION TRACKER C.A.'
 where nombre = 'SOLUCIONES DE LOCALIZACION TRACKER C.A.' and coalesce(razon_social,'') = '';

update proveedores set razon_social = 'MANGUERAS PERIJA C.A.'
 where nombre = 'MANGUERAS PERIJA, C.A.' and coalesce(razon_social,'') = '';

-- ⚠️ PACCINI: el comprobante de GALAC dice «CAUCHERA SR. PACCINI» (nombre
--    comercial), pero el RIF es V-16877824-0 — una CÉDULA, o sea persona
--    natural, y ahí el sujeto retenido es la persona. Máximo, 02/11/2026:
--    «debe salir humberto paccini».
update proveedores set razon_social = 'HUMBERTO PACCINI'
 where nombre = 'HUMBERTO PACCINI (ATLAS)' and coalesce(razon_social,'') = '';
