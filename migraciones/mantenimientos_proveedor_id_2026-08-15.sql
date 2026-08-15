-- ════════════════════════════════════════════════════════════════════════════
-- EL TALLER ES UNA EMPRESA, NO UN TEXTO  ·  BETANGAR
-- ════════════════════════════════════════════════════════════════════════════
-- 2026-08-15. Réplica de la migración que se corrió y verificó hoy en FLOTILLA
-- (`flotilla-app/migraciones/mantenimientos_proveedor_id_2026-08-15.sql`).
-- Mismo motivo: el costo cae en `mantenimientos`, y ahí el taller se guardaba
-- como TEXTO ESCRITO A MANO. Sin identidad no hay comparativo de precios.
--
-- ⛔ ESTA BASE ESTÁ MÁS LIMPIA QUE LA DE FLOTILLA, PERO NO ESTÁ ENLAZADA.
--    De 11 formas escritas, 7 coinciden EXACTO con un proveedor registrado.
--    Coincidir no es estar enlazado: agrupar por texto sigue siendo agrupar por
--    cómo se escribió.
--
-- Lo que había el día de esta migración (154 trabajos):
--
--     AUTO UNION DC, C.A                        40   $756,00   ← sin punto final
--     SERVICAR AUTOLAVADO                       38  $2.280,00  ← no registrado
--     JUAN DAVILA                               33       $0    ← mecánico propio
--     INCONSUMMCA, C.A. (ATLAS)                 12  $1.851,36
--     (vacío)                                   11       $0
--     SERVICAR, C.A.                            10    $700,00
--     AUTO PERIQUITO Y LUBRICANTES FREDD, C.A.   3    $465,76
--     HUMBERTO PACCINI (ATLAS)                   3     $52,00
--     ORLY MENA IMPRENTA                         2    $182,00
--     FERRETERIA BICOLOR, C.A.                   1    $142,90
--     TORNILLOS 2000, C.A.                       1     $67,97
--
-- ── LAS TRES QUE NO COINCIDÍAN, Y QUÉ SE DECIDIÓ CON CADA UNA ───────────────
--
-- 1. «AUTO UNION DC, C.A» (40 trabajos) — le falta EL PUNTO FINAL. El registrado
--    es `P001` = «AUTO UNION DC, C.A.», RIF J-50103023-5. Misma empresa: se
--    enlaza. Un punto de diferencia partía $756 del comparativo.
--
-- 2. «SERVICAR AUTOLAVADO» (38 trabajos, $2.280) — NO está registrado. El único
--    SERVICAR en `proveedores` es «SERVICAR, C.A.» (RIF J-31114663-6).
--    ⛔ MÁXIMO LO AUTORIZÓ HOY, 15/08. Ya lo había confirmado el 21/07, y acá
--       lo confirmó ADEMÁS EL PROPIO SISTEMA: uno de esos 38 trabajos tiene una
--       orden de servicio, y en la orden —donde el taller se ELIGE de la lista,
--       no se escribe— el proveedor es «SERVICAR, C.A.». El texto libre y el
--       camino bueno señalan a la misma empresa.
--       Quedan 48 trabajos y $2.980 en una sola ficha.
--
-- 3. «JUAN DAVILA» (33 trabajos, $0) — NO se enlaza, a propósito. Es el mecánico
--    propio: una persona de la nómina, no un tercero. Meterlo en `proveedores`
--    ensuciaría la tabla que sostiene CxP, IVA y retenciones.
--    ⚠️ Sus 33 trabajos están en $0 porque su sueldo ya está en la nómina. En
--       cuanto exista el comparativo por concepto, ese $0 va a hacer que el
--       taller externo parezca siempre caro y el mecánico propio siempre gratis.
--       Falta costo/hora — está anotado como pendiente, no lo resuelve esta
--       migración.
--
-- ⛔ NINGÚN `LIKE` DECIDE A QUIÉN SE LE CARGA LA PLATA. La lista de abajo se
--    escribió a mano tras mirar las 11 filas reales. Se comprobó además que no
--    hay UN SOLO caso donde la lista y la orden de servicio se contradigan (30
--    filas comparables, 0 conflictos).
--
-- El texto original NO se pisa a ciegas: se respalda entero antes de tocarlo, y
-- la reversa lo devuelve fila por fila.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. La columna ───────────────────────────────────────────────────────────
alter table public.mantenimientos
  add column if not exists proveedor_id text;

comment on column public.mantenimientos.proveedor_id is
  'FK blanda a proveedores.id. FUENTE ÚNICA de quién hizo el trabajo. La columna `proveedor` queda como caché del nombre para mostrar, NO para agrupar ni comparar. NULL legítimo = mano de obra propia (persona de nómina, no proveedor).';

create index if not exists mantenimientos_proveedor_id_idx
  on public.mantenimientos (proveedor_id);

-- ── 2. Respaldo del texto tal cual está hoy (lo que deshace la reversa) ─────
create table if not exists public._bkp_mant_proveedor_20260815 as
  select id, proveedor from public.mantenimientos;

-- ── 3. Unión por lista EXPLÍCITA ────────────────────────────────────────────
-- Cada renglón se escribió después de mirar la fila real. Si mañana aparece una
-- forma nueva, se agrega acá a mano: no se adivina.
with mapa(escrito, prov_id) as (values
  ('AUTO UNION DC, C.A',                       'P001'),            -- sin punto final
  ('AUTO PERIQUITO Y LUBRICANTES FREDD, C.A.', 'P1784306921673'),
  ('FERRETERIA BICOLOR, C.A.',                 'P1784048600000'),
  ('HUMBERTO PACCINI (ATLAS)',                 'P1784057247222'),
  ('INCONSUMMCA, C.A. (ATLAS)',                'P1784056326480'),
  ('ORLY MENA IMPRENTA',                       'P1784212413645'),
  ('SERVICAR, C.A.',                           'P1784041934715'),
  ('SERVICAR AUTOLAVADO',                      'P1784041934715'),  -- autorizado 15/08
  ('TORNILLOS 2000, C.A.',                     'P1784048714207')
)
update public.mantenimientos m
   set proveedor_id = mapa.prov_id,
       proveedor    = p.nombre          -- el nombre pasa a ser el del proveedor real
  from mapa
  join public.proveedores p on p.id = mapa.prov_id
 where m.proveedor = mapa.escrito
   and m.proveedor_id is null;

-- ── 4. El que SÍ vino de una orden hereda el enlace de la orden ─────────────
-- La orden es más confiable que el texto: ahí el taller se eligió de la lista.
-- ⚠️ En esta base 124 de los 154 `orden_id` apuntan a una orden que YA NO EXISTE.
--    El join de abajo los ignora solo: no inventa enlace donde no hay orden.
update public.mantenimientos m
   set proveedor_id = o.proveedor_id,
       proveedor    = coalesce(p.nombre, m.proveedor)
  from public.ordenes_servicio o
  left join public.proveedores p on p.id = o.proveedor_id
 where m.orden_id = o.id
   and o.proveedor_id is not null
   and m.proveedor_id is null;

commit;

-- ── Comprobación ────────────────────────────────────────────────────────────
-- Deben quedar SOLO los 33 de JUAN DAVILA (mano de obra propia) y los 11 vacíos:
-- select coalesce(proveedor,'(vacio)'), count(*) from public.mantenimientos
--  where proveedor_id is null group by 1 order by 2 desc;
--
-- ── Lo que se quería ver, ya agrupado de verdad ─────────────────────────────
-- select p.nombre, count(*) trabajos, sum(m.costo_usd) usd
--   from public.mantenimientos m join public.proveedores p on p.id=m.proveedor_id
--  group by 1 order by 3 desc;


-- ════════════════════════════════════════════════════════════════════════════
-- REVERSA
-- ════════════════════════════════════════════════════════════════════════════
-- begin;
--   update public.mantenimientos m
--      set proveedor = b.proveedor
--     from public._bkp_mant_proveedor_20260815 b
--    where b.id = m.id;
--   drop index if exists public.mantenimientos_proveedor_id_idx;
--   alter table public.mantenimientos drop column if exists proveedor_id;
--   drop table if exists public._bkp_mant_proveedor_20260815;
-- commit;
