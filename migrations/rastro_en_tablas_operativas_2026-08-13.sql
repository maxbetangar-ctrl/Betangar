-- ============================================================================
-- RASTRO DE AUDITORIA EN LAS 6 TABLAS OPERATIVAS
--
-- El problema: checklist, km_data, viajes_chofer, combustible_mediciones,
-- asistencia y porteria tenian politica `true` para INSERT y UPDATE de `anon`.
-- La clave `anon` viaja en el bundle del navegador de la PWA del chofer, o sea
-- la tiene cualquiera que abra el inspector. Con ella se podia MODIFICAR un
-- viaje ya cargado, bajar un odometro o cambiar una medicion de combustible,
-- y quedaba escrito como si lo hubiera hecho el chofer.
-- En FLOTILLA eran 1.122 filas alterables sin dejar huella, 809 de ellas viajes.
--
-- Por que NO se cerro el permiso: la PWA del chofer no tiene login (entra por
-- QR) y usa upsert sobre esas tablas -- km_data solo tiene 11 updates y 3
-- upserts en el codigo. Cerrar el UPDATE dejaba a los choferes sin poder
-- cargar nada al dia siguiente. Eso es «un candado que rompe la herramienta».
--
-- Lo que SI se hace: que ninguna modificacion pueda pasar sin quedar
-- registrada. No es lo mismo que impedirla, y no se debe vender como tal --
-- pero es lo que un ente publico necesita: trazabilidad y no repudio.
--
-- Se REUSA `audit_sensible`, que ya audita 18 tablas del lado administrativo
-- (abonos, nomina, pagos, proveedores...). Misma funcion, mismo nombre de
-- trigger, mismo timing. No se invento una pieza nueva.
--
-- ⚠️ AFTER, nunca BEFORE: `audit_sensible` termina en `return null`. En un
-- trigger BEFORE eso CANCELA la escritura y tumba la operacion entera.
--
-- Riesgo de romper: minimo. No toca permisos ni politicas, y la funcion traga
-- cualquier excepcion (`exception when others then null`) para que el log
-- JAMAS bloquee la operacion real.
--
-- Verificado en vivo el 13/08 sobre FLOTILLA con la clave anon real:
--   1) UPDATE desde `anon` -> HTTP 200 (la PWA sigue escribiendo)
--   2) quedo en `auditoria`: «(sin sesion) | DB checklist UPDATE | {...}»
-- `anon` no tiene ningun grant sobre `auditoria`: no puede leer ni borrar su
-- propio rastro.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'asistencia', 'checklist', 'combustible_mediciones',
    'km_data', 'porteria', 'viajes_chofer'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'no existe public.%, se salta', t;
      continue;
    end if;
    execute format('drop trigger if exists trg_audit_sensible on public.%I', t);
    execute format(
      'create trigger trg_audit_sensible after delete or update on public.%I '
      'for each row execute function public.audit_sensible()', t);
  end loop;
end $$;

-- Comprobacion: aborta si alguno quedo mal o con timing BEFORE.
do $$
declare n int; malos int;
begin
  select count(*) into n
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and p.proname = 'audit_sensible'
     and not tg.tgisinternal
     and c.relname in ('asistencia','checklist','combustible_mediciones',
                       'km_data','porteria','viajes_chofer');

  select count(*) into malos
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and p.proname = 'audit_sensible'
     and not tg.tgisinternal
     and c.relname in ('asistencia','checklist','combustible_mediciones',
                       'km_data','porteria','viajes_chofer')
     and pg_get_triggerdef(tg.oid) !~* 'AFTER DELETE OR UPDATE';

  if malos > 0 then
    raise exception 'ABORTA: % trigger(s) con timing incorrecto (deben ser AFTER)', malos;
  end if;
  raise notice 'OK: % de 6 tablas con rastro, todos AFTER', n;
end $$;
