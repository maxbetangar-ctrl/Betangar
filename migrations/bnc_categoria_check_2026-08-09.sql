-- ⛔ LA CATEGORÍA SE VALIDA EN LA BASE, NO EN EL DESPLEGABLE.
-- Revisión de seguridad del 09/08: era `text` libre y la política de UPDATE deja escribirla a
-- operador, rrhh, directivo y las cuentas demo. Por PostgREST se podía meter cualquier cosa
-- --incluido HTML-- y la pantalla de Movimientos (solo superadmin) lo pintaba con innerHTML.
-- El escape en la app arregla el sintoma; esto cierra la puerta.
--
-- ⚠️ EL CATÁLOGO SALE DE LAS TRES FUENTES, NO SOLO DE LO QUE YA EXISTE. El primer intento lo armó
-- con los 25 valores en uso y habría RECHAZADO la primera clasificacion como 'caja_chica' o
-- 'sin_clasificar': un candado que rompe la herramienta es peor que no tenerlo, y encima falla
-- cuando alguien está trabajando. Se unifica REL_CATS (app.js) + NOMBRE_CAT (Excel) + lo guardado.
-- Si se agrega una categoría nueva, hay que agregarla en los TRES sitios.
alter table public.bnc_movimientos drop constraint if exists bnc_mov_categoria_valida;
alter table public.bnc_movimientos add constraint bnc_mov_categoria_valida
  check (categoria is null or categoria in ('alquiler','asignacion_1b','bienestar_personal','caja_chica','cobro_alcaldia','combustible','comision_banco','compra_divisas','compra_software','dotacion','duplicado','gasto','implantacion_maxware','impuestos','mantenimiento','nomina','otro','otro_ingreso','pago_socio','parafiscales','prestamo_empleado','prueba_sistema','reembolso','resp_social','reverso','seguro','servicios','sin_clasificar','software','tramites','transito_terceros','traspaso_interno','⏳pendiente_explicar'))
  not valid;
alter table public.bnc_movimientos validate constraint bnc_mov_categoria_valida;
