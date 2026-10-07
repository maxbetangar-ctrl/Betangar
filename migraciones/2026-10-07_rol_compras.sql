-- ═══════════════════════════════════════════════════════════════════════════════
-- EL ROL `compras` NO PODÍA COMPRAR — lo reportó Alejandra el 01/10/2026
--
-- 🔴 LOS DOS SÍNTOMAS QUE MANDÓ, y son EL MISMO candado:
--      «Se le creó el usuario a Dalia rol compras y no le permite añadir un proveedor,
--       aparece una leyenda que dice: New row violates row Level security policy for
--       table "proveedores"»
--      «Y en órdenes de servicio no le aparece información (no aparece el historial
--       de órdenes)»
--
--    El primero GRITA. El segundo se CALLA: un SELECT negado no da error, devuelve
--    CERO FILAS — y una pantalla vacía se lee como «no hay órdenes», no como «no
--    tengo permiso». Por eso el segundo podía llevar semanas sin que nadie lo viera.
--
-- 🔴 EL MECANISMO: DOS LISTAS A MANO QUE SE DESINCRONIZARON. `app.js` le da al rol
--    siete módulos —
--      compras:['dashboard','requisitorio','ordenes','proveedores','inventario','unidades','documentos']
--    — y la base no tiene UNA SOLA policy que lo nombre. La pantalla se abre porque el
--    permiso lo decide el CÓDIGO; la operación falla porque el candado lo decide la BASE.
--
-- ✅ MEDIDO TABLA POR TABLA MIRANDO LA REGLA, no el nombre del rol (contar el nombre
--    no mide la definición: varias de estas tablas dicen `true` y no nombran a nadie):
--      requisitorio → requisiciones · req_lineas · req_cotizaciones   ✅ app_rol() IS NOT NULL
--      inventario   → inventario · inv_movimientos · mant_items       ✅ true
--      unidades     → unidad_config                                   ✅ true
--      ordenes      → ordenes_servicio                                ⛔ los 3 verbos
--      proveedores  → proveedores                                     ⛔ los 3 verbos
--      inventario   → piezas                                          ⛔ los 3 verbos
--    O sea: de los siete módulos, el rol solo podía trabajar tres. Y el hueco es el
--    MISMO en Betangar, FLOTILLA, Tony Gas y VIDECA: 9 de 9 en ⛔ en las cuatro bases.
--
-- ⛔ NO SE LO METE EN `btg_rol_lectura` NI EN `btg_rol_ins`. Esas policies están en
--    decenas de tablas —cxp, abonos, nómina, préstamos, caja chica, movimientos del
--    banco— y agregarle un rol le abre todas de un saque. Van policies ESTRECHAS: un
--    rol, una tabla, un verbo. Es lo mismo que se decidió el 04/09 con `analista` y el
--    08/09 con `mantenimiento`.
--
-- ⛔ LO QUE NO LLEVA, y NO es olvido: `cxp`, `cxp_facturas`, `cxp_pagos`, `cxp_pagos`,
--    banco, nómina y caja chica. El rol tiene 'proveedores' en su lista de módulos pero
--    NO tiene 'cxp' ni 'financiero': ELIGE A QUIÉN COMPRARLE — no paga. Tampoco lleva
--    DELETE: anular sigue siendo de `app_puede_borrar()`, que es solo superadmin.
--
-- ⚠️ `piezas` lleva INSERT y UPDATE, no solo lectura: el reemplazo de una pieza va por
--    `piezas_reemplazar()`, que es SECURITY INVOKER — corre con los permisos de quien
--    la llama. Sin escritura en la tabla el botón falla aunque la función esté concedida.
--    Es la misma razón que se escribió el 08/09 para `mantenimiento`.
--
-- ⚠️ LO QUE ESTA MIGRACIÓN NO ARREGLA, y queda DICHO: `documentos_cam` y
--    `documentos_emp` tienen RLS ENCENDIDO y CERO policies. Ahí no lee NADIE con rol
--    —no solo compras— así que el módulo 'documentos' de la lista sigue vacío para
--    todo el mundo. Es un hueco distinto, afecta a todos los roles, y se decide aparte.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Proveedores: elige a quién comprarle, y puede cargar uno nuevo ────────────
drop policy if exists prov_compras_sel on public.proveedores;
create policy prov_compras_sel on public.proveedores
  for select to authenticated using (app_rol() = 'compras');

drop policy if exists prov_compras_ins on public.proveedores;
create policy prov_compras_ins on public.proveedores
  for insert to authenticated with check (app_rol() = 'compras');

drop policy if exists prov_compras_upd on public.proveedores;
create policy prov_compras_upd on public.proveedores
  for update to authenticated using (app_rol() = 'compras') with check (app_rol() = 'compras');

-- ── Órdenes de servicio: las ve, las crea y las trabaja ───────────────────────
drop policy if exists os_compras_sel on public.ordenes_servicio;
create policy os_compras_sel on public.ordenes_servicio
  for select to authenticated using (app_rol() = 'compras');

drop policy if exists os_compras_ins on public.ordenes_servicio;
create policy os_compras_ins on public.ordenes_servicio
  for insert to authenticated with check (app_rol() = 'compras');

drop policy if exists os_compras_upd on public.ordenes_servicio;
create policy os_compras_upd on public.ordenes_servicio
  for update to authenticated using (app_rol() = 'compras') with check (app_rol() = 'compras');

-- ── Piezas: el módulo de inventario, y el botón de reemplazar (SECURITY INVOKER)
drop policy if exists piezas_compras_sel on public.piezas;
create policy piezas_compras_sel on public.piezas
  for select to authenticated using (app_rol() = 'compras');

drop policy if exists piezas_compras_ins on public.piezas;
create policy piezas_compras_ins on public.piezas
  for insert to authenticated with check (app_rol() = 'compras');

drop policy if exists piezas_compras_upd on public.piezas;
create policy piezas_compras_upd on public.piezas
  for update to authenticated using (app_rol() = 'compras') with check (app_rol() = 'compras');
