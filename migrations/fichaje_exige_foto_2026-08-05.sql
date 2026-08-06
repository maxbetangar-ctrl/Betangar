-- BETANGAR — un fichaje sin foto no se guarda.
--
-- EL CASO (2026-08-05): `fichar.html` exige la selfie para habilitar el botón, pero si la SUBIDA al
-- storage fallaba el código seguía de largo con `selfieUrl=''` y el fichaje quedaba registrado igual,
-- sin imagen. Entre el 01/06 y el 05/08 hay 13 fichajes así (de 448). La foto es la ÚNICA evidencia
-- de que la persona estuvo: un fichaje sin ella no prueba nada, y esa presencia después se paga
-- (alimenta el patio y el cotejo de RRHH).
--
-- La pantalla ya corta antes (commit de hoy), pero la pantalla no es el candado: cualquier cliente
-- viejo cacheado, o una llamada directa a la RPC, vuelve a meter filas sin foto. El candado va en la
-- BASE. Ver [norma-barrido-no-es-candado] y [norma-foto-de-evidencia-camara-en-vivo].
--
-- ALCANCE: solo los registros de FICHAJE (origen 'fichaje' / 'fichaje_qr'). Las marcas que carga la
-- oficina a mano con otro `origen` siguen entrando sin foto, que es como debe ser.
--
-- NO se tocan las 13 filas viejas: son el registro de lo que pasó. Quedan listadas al final para que
-- RRHH decida qué hacer con cada una.

create or replace function public.fichaje_exige_foto()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.origen,'') like 'fichaje%' and coalesce(btrim(new.selfie_url),'') = '' then
    raise exception 'El fichaje necesita la foto: no se subió la imagen (empleado %, fecha %)',
      new.empleado_id, new.fecha
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_fichaje_exige_foto on public.asistencia_dia;
create trigger trg_fichaje_exige_foto
  before insert or update on public.asistencia_dia
  for each row execute function public.fichaje_exige_foto();

-- Los que ya quedaron sin foto (para revisar con RRHH, no se borran acá):
--   select fecha, empleado_id, nombre, origen
--     from public.asistencia_dia
--    where coalesce(btrim(selfie_url),'') = ''
--    order by fecha desc;

-- Deshacer:
--   drop trigger if exists trg_fichaje_exige_foto on public.asistencia_dia;
--   drop function if exists public.fichaje_exige_foto();
