-- ═══════════════════════════════════════════════════════════════════════════════
-- LA GARITA NECESITA NOMBRES, NO EXPEDIENTES
--
-- 🔴 POR QUÉ. Alejandra, 07/09: «En el usuario de vigilante, en la sesión
--    entrada/salida, únicamente me figura en la lista los choferes, máximo y
--    Francisco. Debería aparecer también Leonardo, Samuel, Jinet, mi persona».
--    Los cuatro ESTÁN activos en `empleados` (61 activos, solo 13 choferes). Lo que
--    pasa es que la policy de SELECT de `empleados` (`btg_rol_lectura`) lista once
--    roles y **`vigilante` no está en ninguno**: su sesión lee CERO filas y la
--    pantalla cae en una lista parcial que viene de otro lado.
--    Es la misma forma del caso Yudis del 04/09: no da error, muestra menos.
--
-- ⛔ Y POR ESO NO SE LE AGREGA `vigilante` A `btg_rol_lectura`. Dos razones:
--    1. Esa policy está en 23 tablas: meterlo ahí le abre las 23 de un saque.
--    2. `empleados` tiene `sueldo`, `banco`, `ncuenta`, `cedula` y `wa_apikey`.
--       La garita suele ser un equipo compartido. Darle la tabla sería publicar
--       los sueldos y las cuentas bancarias de 84 personas para registrar visitas.
--
-- ⇒ La garita recibe UNA LISTA DE NOMBRES y nada más. Ni cédula, ni teléfono.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.porteria_personas()
returns table (nombre text, cargo text)
language sql
stable
security definer
set search_path = public
as $$
  select e.nombre, e.cargo
    from public.empleados e
   where e.activo is true
     and coalesce(e.nombre,'') <> ''
   order by e.nombre
$$;

-- ⛔ TODA FUNCIÓN NACE ABIERTA A PUBLIC: el `grant` no cierra, hay que REVOCAR.
--    Sin esto, `anon` —o sea, cualquiera con la llave pública— la puede llamar.
revoke all on function public.porteria_personas() from public;
revoke all on function public.porteria_personas() from anon;
grant execute on function public.porteria_personas() to authenticated;

comment on function public.porteria_personas() is
  'Nombres y cargos de los empleados ACTIVOS, para la lista de la garita. Existe porque el rol vigilante no puede leer `empleados` (tiene sueldos y cuentas bancarias) y solo necesita nombres. Alejandra 07/09.';
