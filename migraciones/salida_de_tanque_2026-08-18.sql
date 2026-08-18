-- ============================================================================
-- SALIDA DE TANQUE PARA OTRO USO  ·  18/08/2026
--
-- El agujero que tapa: hasta hoy el sistema sabía cuánto gasoil ENTRABA al
-- tanque del galpón (Compra de Combustible) y cuánto SALÍA hacia un camión
-- (⛽ Surtir), pero no tenía dónde anotar el gasoil que sale para otra cosa.
-- Los 25 L que se le echaron a la planta eléctrica solo existían en un grupo de
-- WhatsApp. Mientras eso no se pueda registrar, cada revisión del tanque va a
-- dar un faltante que no es faltante — y un faltante falso repetido enseña a no
-- creerle a la alarma [[norma-movimiento-que-el-sistema-no-registra]].
--
-- 🔐 QUIÉN PUEDE: Máximo lo definió — Samuel (rol `operativo`) es el único
--    autorizado, más los superadmin. El candado va EN LA BASE, no en la
--    pantalla. Es la misma lección de esta mañana con «Despacho a Camión»:
--    esconder el formulario no cierra nada, porque la pestaña vieja en caché,
--    la cola offline y la consola llegan igual.
--
-- ⛔ LEER SÍ PUEDE TODO EL MUNDO. No es un dato secreto: la oficina necesita
--    verlo para cuadrar el tanque. Lo que se restringe es ESCRIBIR.
--
-- Idempotente: `if not exists` en todo.
-- ============================================================================

create table if not exists salidas_tanque (
  id             text primary key,
  fecha          date        not null,
  tanque         text        not null check (tanque in ('galpon_1','galpon_2')),
  litros         numeric     not null check (litros > 0 and litros <= 2300),
  destino        text        not null,
  nota           text,
  registrado_por text,
  created_at     timestamptz not null default now()
);

comment on table salidas_tanque is
  'Gasoil que sale del tanque del galpón para algo que NO es un camión de la flota '
  '(planta eléctrica, préstamo, trasvase). Sin esta tabla el tanque nunca cuadra y '
  'la auditoría produce faltantes falsos. La carga Samuel (rol operativo).';

comment on column salidas_tanque.litros is
  'Tope 2.300 L = la capacidad del tanque del galpón. No es un número redondo: es '
  'el máximo físico que puede salir de una vez. Un dato imposible se RECHAZA, no se topa.';

comment on column salidas_tanque.destino is
  'Para qué salió. Se guarda el texto que eligió quien lo cargó, no un código: si '
  'mañana aparece un uso nuevo, se escribe y ya — un catálogo cerrado trancaría el registro.';

create index if not exists ix_salidas_tanque_fecha on salidas_tanque (fecha desc);

alter table salidas_tanque enable row level security;

-- ── LEER: todos los que entran a la app ──────────────────────────────────────
drop policy if exists st_sel on salidas_tanque;
create policy st_sel on salidas_tanque for select using (true);

-- ── ESCRIBIR: solo Samuel y los superadmin ───────────────────────────────────
-- `app_solo_lectura()` se respeta igual que en el resto: un acceso de solo
-- lectura no escribe ni siendo del rol correcto.
drop policy if exists st_ins on salidas_tanque;
create policy st_ins on salidas_tanque for insert
  with check (app_rol() = any (array['operativo','superadmin']) and not app_solo_lectura());

drop policy if exists st_upd on salidas_tanque;
create policy st_upd on salidas_tanque for update
  using      (app_rol() = any (array['operativo','superadmin']) and not app_solo_lectura())
  with check (app_rol() = any (array['operativo','superadmin']) and not app_solo_lectura());

-- Borrar sigue la misma puerta que el resto de la casa: token + rol, no el rol solo.
drop policy if exists st_del on salidas_tanque;
create policy st_del on salidas_tanque for delete
  using (app_puede_borrar() and not app_solo_lectura());
