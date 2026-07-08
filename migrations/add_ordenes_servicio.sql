-- ════════════════════════════════════════════════════════════════════════════
-- ÓRDENES DE SERVICIO (Fase 1) — persistir la orden (antes era solo papel efímero).
-- La orden se emite liviana (unidad, proveedor, tipo de servicio, ítem, notas) para
-- mandar el carro; el km/costo/etc. se llenan al CERRAR (Fase 2, registro de mantenimiento).
-- RLS fail-closed: solo roles de OFICINA (igual que las tablas sensibles). Anon fuera.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.ordenes_servicio (
  id           text primary key,
  fecha        date,                       -- fecha de emisión
  cams         jsonb  default '[]'::jsonb,  -- unidades ["JAC-B001",...]
  proveedor    text   default '',           -- nombre del proveedor/taller (texto)
  proveedor_id text   default '',           -- id del módulo proveedores (si se eligió del catálogo)
  tipo_servicio text  default '',           -- lavado | cambio | inspeccion | correctivo | preventivo | otro
  item         text   default '',           -- qué se hará (del catálogo o texto)
  notas        text   default '',
  estado       text   default 'emitida',    -- emitida | en_proceso | hecha
  fecha_cierre date,                         -- se llena al cerrar (Fase 2)
  costo_usd    numeric,                      -- se llena al cerrar (Fase 2)
  creado_en    timestamptz default now()
);

alter table public.ordenes_servicio enable row level security;
revoke all on public.ordenes_servicio from anon;
grant all on public.ordenes_servicio to authenticated;

-- Escritura/CRUD: roles de oficina que operan mantenimiento.
drop policy if exists os_rw on public.ordenes_servicio;
create policy os_rw on public.ordenes_servicio for all to authenticated
  using      (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']))
  with check (app_rol() = any(array['superadmin','admin','operador','rrhh','directivo','demo_admin','demo_operador','demo_rrhh']));
-- Lectura extra para visualizador (solo ver).
drop policy if exists os_ro on public.ordenes_servicio;
create policy os_ro on public.ordenes_servicio for select to authenticated
  using (app_rol() = 'visualizador');
