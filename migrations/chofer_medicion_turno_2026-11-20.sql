-- ═══════════════════════════════════════════════════════════════════════════
-- CHOFER_MEDICION RECIBE TURNO Y ORDENA POR CREATED_AT DESC
-- 20/11/2026
--
-- 🔴 QUÉ PASABA. El 06/11/2026 se agregó `turno` a `combustible_mediciones` y a su
--    llave única (vehiculo_id, fecha, momento, turno). Pero la función de lectura
--    `chofer_medicion` quedó sin `p_turno` y haciendo `limit 1` sin orden:
--      select altura_cm from public.combustible_mediciones
--       where vehiculo_id = p_cam and fecha = p_fecha and momento = p_momento ... limit 1
--
--    Resultado en dos turnos (reportado por Alejandra 19/11/2026):
--      · Turno diurno: salida 31 cm, llegada 26 cm.
--      · Turno nocturno: salida 26 cm.
--    Al hacer el cierre del nocturno, la app llama a `chofer_medicion` para
--    mostrar con cuánto salió. Como no filtraba por turno ni ordenaba,
--    Postgres devolvía la fila del DIURNO (31 cm). El chofer de la noche
--    veía "CM al SALIR del galpón: 31 cm" como si él hubiese puesto esa marca.
--
-- ⛔ ARREGLO:
--    1. `chofer_medicion` acepta `p_turno text default null`.
--    2. Si `p_turno` viene, filtra `and (p_turno is null or turno = p_turno)`.
--    3. Siempre ordena `order by created_at desc` antes del `limit 1`.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.chofer_medicion(text, date, text);

create or replace function public.chofer_medicion(
  p_cam text,
  p_fecha date,
  p_momento text,
  p_turno text default null
)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $$
  select altura_cm from public.combustible_mediciones
   where vehiculo_id = p_cam
     and fecha = p_fecha
     and momento = p_momento
     and (p_turno is null or turno = p_turno)
     and public.chofer_puede_ver(p_cam)
   order by created_at desc
   limit 1;
$$;

revoke all on function public.chofer_medicion(text, date, text, text) from public;
grant execute on function public.chofer_medicion(text, date, text, text) to anon, authenticated;
