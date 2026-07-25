-- ════════════════════════════════════════════════════════════════════════════
-- BORRAR = SOLO SUPERADMIN + TOKEN   (2026-07-25)   proyecto hrkjddehqnzcqwlkklqm
--
-- CAUSA: Máximo vio que RRHH pudo borrar registros sin que nadie lo autorizara.
-- Al revisar salieron DOS agujeros, no uno:
--   (a) UI: de 26 borrados en app.js, solo 6 pasaban por `solicitarToken`. Los otros
--       borraban directo (nómina histórica, actividades especiales, facturas de compra,
--       inventario, mantenimientos, catálogo, unidades, tipos, operaciones, sitios de
--       asistencia, mediciones de tanque, empleados duplicados).
--   (b) BD: varias tablas tenían UNA política `FOR ALL USING(true)` para `authenticated`
--       = cualquier usuario logueado podía borrar por REST aunque la pantalla no
--       le mostrara el botón. Y `nomina_historial` / `cxp_facturas` tenían a **rrhh**
--       explícitamente en la lista de quien puede borrar.
--
-- ARREGLO (dos niveles, norma de seguridad):
--   1. BD: políticas VERBO POR VERBO. SELECT/INSERT/UPDATE quedan como estaban;
--      el DELETE queda solo para `superadmin`, igual que ya estaba en planillas/empleados.
--   2. UI: los 13 borrados sueltos ahora piden token (`solicitarToken(..., {op:'del'})`),
--      y el superadmin ejecuta el borrado server-side al aprobar.
--   3. `btg_usuarios.exige_token`: un usuario puede tener rol total y AUN ASÍ deberle el
--      token a otro (caso Alejandra). No se auto-exime ni puede aprobar tokens.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tablas que tenían ALL true ──
drop policy if exists btg_auth_all on public.inventario;
create policy inv_sel on public.inventario for select to authenticated using (true);
create policy inv_ins on public.inventario for insert to authenticated with check (true);
create policy inv_upd on public.inventario for update to authenticated using (true) with check (true);
create policy inv_del on public.inventario for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists btg_auth_all on public.mantenimientos;
create policy mant_sel on public.mantenimientos for select to authenticated using (true);
create policy mant_ins on public.mantenimientos for insert to authenticated with check (true);
create policy mant_upd on public.mantenimientos for update to authenticated using (true) with check (true);
create policy mant_del on public.mantenimientos for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists mant_items_auth on public.mant_items;
create policy mi_sel on public.mant_items for select to authenticated using (true);
create policy mi_ins on public.mant_items for insert to authenticated with check (true);
create policy mi_upd on public.mant_items for update to authenticated using (true) with check (true);
create policy mi_del on public.mant_items for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists op_auth on public.operaciones;
create policy opm_sel on public.operaciones for select to authenticated using (true);
create policy opm_ins on public.operaciones for insert to authenticated with check (true);
create policy opm_upd on public.operaciones for update to authenticated using (true) with check (true);
create policy opm_del on public.operaciones for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists tu_auth on public.tipos_unidad;
create policy tun_sel on public.tipos_unidad for select to authenticated using (true);
create policy tun_ins on public.tipos_unidad for insert to authenticated with check (true);
create policy tun_upd on public.tipos_unidad for update to authenticated using (true) with check (true);
create policy tun_del on public.tipos_unidad for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists un_auth on public.unidades;
create policy uni_sel on public.unidades for select to authenticated using (true);
create policy uni_ins on public.unidades for insert to authenticated with check (true);
create policy uni_upd on public.unidades for update to authenticated using (true) with check (true);
create policy uni_del on public.unidades for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists nomina_extras_auth on public.nomina_extras;
create policy nex_sel on public.nomina_extras for select to authenticated using (true);
create policy nex_ins on public.nomina_extras for insert to authenticated with check (true);
create policy nex_upd on public.nomina_extras for update to authenticated using (true) with check (true);
create policy nex_del on public.nomina_extras for delete to authenticated using (app_rol() = 'superadmin');

-- combustible_mediciones: el chofer (anon) sigue midiendo e insertando; borrar, solo superadmin.
drop policy if exists btg_auth_all on public.combustible_mediciones;
create policy cme_sel on public.combustible_mediciones for select to authenticated using (true);
create policy cme_ins on public.combustible_mediciones for insert to authenticated with check (true);
create policy cme_upd on public.combustible_mediciones for update to authenticated using (true) with check (true);
create policy cme_del on public.combustible_mediciones for delete to authenticated using (app_rol() = 'superadmin');

-- ── 2. Donde RRHH SÍ podía borrar (esto es lo que vio Máximo) ──
drop policy if exists btg_rol_del on public.nomina_historial;
create policy nh_del on public.nomina_historial for delete to authenticated using (app_rol() = 'superadmin');

drop policy if exists btg_rol_del on public.cxp_facturas;
create policy cxpf_del on public.cxp_facturas for delete to authenticated using (app_rol() = 'superadmin');

-- ── 3. Usuarios con rol total que igual deben pedir token (Alejandra) ──
alter table public.btg_usuarios add column if not exists exige_token boolean not null default false;
comment on column public.btg_usuarios.exige_token is
  'true = a este usuario se le pide token para borrar/editar aunque su rol sea superadmin';

-- ════════════════════════════════════════════════════════════════════════════
-- SEGUNDA TANDA (mismo día): al verificar salió que había OTRAS 23 tablas con la
-- misma política `FOR ALL` para authenticated — incluida `auditoria`, o sea que se
-- podía borrar la propia bitácora. Se comprobó EN EL CÓDIGO que la app no borra de
-- ninguna de ellas (el único delete automático que quedó fuera es seniat_retenciones,
-- que lo hace el recálculo de retenciones al tocar una factura).
-- Aplicado con las migraciones `cerrar_delete_tablas_for_all` y
-- `cerrar_delete_viajes_chofer_y_backup`:
--   · anomalias, asistencia_dia, calendario_fiscal, checklist, cola_mensajes,
--     combustible_alertas, combustible_tanques_config, combustible_vehiculos_config,
--     engrases, entregas, inv_movimientos, km_data, lavados, llantas, mensajes_wa,
--     porteria, rutas_estado, tasas_diarias, unidad_config, ordenes_servicio,
--     viajes_chofer → SELECT/INSERT/UPDATE igual que antes, DELETE solo superadmin.
--   · auditoria → SOLO AGREGAR (sin política de delete: la bitácora no se borra
--     desde la app, ni siquiera el superadmin).
--   · zzz_flota_estado_bak (respaldo) → solo lectura.
-- El chofer entra con anon y sus políticas quedaron intactas (anon nunca tuvo delete).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- TERCERA TANDA — ROL `auditor` (pedido de Máximo el mismo día):
-- "un rol que no sea superadmin pero que tenga acceso a todo y tenga que pedir
--  autorización". Es más limpio que un superadmin con excepción: el candado queda
--  en el ROL y no en una marca por usuario.
-- Migraciones `exige_token_tambien_en_la_base` y `rol_auditor_ve_todo_pero_pide_autorizacion`:
--   · funciones app_exige_token() y app_puede_borrar() (= superadmin y sin exige_token).
--     TODAS las políticas de DELETE pasaron a usar app_puede_borrar().
--   · se agregó 'auditor' a las 54 políticas que enumeran roles (SELECT/INSERT/UPDATE),
--     y a NINGUNA de DELETE.
-- En la app: PERMISOS.auditor = la MISMA lista del superadmin (fuente única), 2FA
-- obligatorio, y esMando() para que no se le escondan los botones (si no, no podría
-- ni pedir la autorización). Como no es superadmin, solicitarToken siempre le pide
-- el código y el panel de aprobar tokens no le aparece: no puede autorizarse solo.
--
-- Usuario creado: alejandra / alejandra@betangar.local (rol auditor, exige_token=true).
-- ════════════════════════════════════════════════════════════════════════════
