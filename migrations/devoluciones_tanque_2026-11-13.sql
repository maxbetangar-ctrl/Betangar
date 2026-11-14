-- ═══════════════════════════════════════════════════════════════════════════════
-- EL GASOIL QUE VUELVE: CAMIÓN → TANQUE
--
-- 🔴 POR QUÉ. Máximo, 13/11/2026: «necesito cargar algo en el sistema de un gasoil
--    que le saqué a los camiones y pusimos en el tanque». El 10/11 se le sacó gasoil
--    a 10 unidades y se echó al tanque aéreo del galpón: 1.265 L declarados.
--
-- ⛔ ESE MOVIMIENTO NO EXISTÍA. El sistema sabía mover gasoil en tres direcciones y
--    le faltaba justo ésta:
--      tanque  → camión .......... `surtidas`
--      tanque  → otro destino .... `salidas_tanque`   (planta, préstamo, trasvase)
--      camión  → camión .......... `trasvases_unidad`
--      camión  → TANQUE .......... NO HABÍA
--
--    Sin esta fila el movimiento rompe el cuadre POR LOS DOS LADOS a la vez: la
--    unidad aparece gastando un combustible que no quemó, y el tanque aparece
--    recibiendo litros sin origen (que es justo lo que dispara R14, «amaneció con
--    más»). Meterlo en cualquiera de las otras tres tablas arregla un lado y empeora
--    el otro. [[norma-salida-de-banco-no-es-gasto]] — misma forma: un movimiento que
--    no es lo que parece.
--
-- ⚠️ LO QUE ESTO **NO** HACE. La auditoría de combustible todavía NO LEE esta tabla.
--    Acá queda el HECHO registrado y con su historia; engancharlo al cuadre toca el
--    motor y va aparte, decidido con Máximo. Hasta entonces, las unidades del 10/11
--    van a seguir figurando con consumo de más: la diferencia ahora tiene dónde
--    mirarse, que antes no.
--
-- 📌 Acceso: copiado de `salidas_tanque`, que es la hermana más cercana. SOLO
--    `authenticated` — a `anon` NO se le da nada (la app de oficina entra con sesión;
--    la del chofer no toca esto). [[norma-toda-funcion-nace-abierta-a-public]]
-- ═══════════════════════════════════════════════════════════════════════════════

create table if not exists public.devoluciones_tanque (
  id              text primary key,
  fecha           date        not null,
  cam             text        not null,          -- de qué unidad salió
  tanque          text        not null,          -- a qué tanque entró
  litros          numeric     not null check (litros > 0),
  motivo          text,                          -- por qué se sacó
  nota            text,
  registrado_por  text,
  created_at      timestamptz not null default now()
);

comment on table public.devoluciones_tanque is
  'Gasoil que SALE de la unidad y ENTRA a un tanque propio. Es el inverso de `surtidas`. Sin esta fila la unidad figura gastando lo que no quemó y el tanque recibiendo litros sin origen.';
comment on column public.devoluciones_tanque.cam is 'Unidad de la que se extrajo el combustible.';
comment on column public.devoluciones_tanque.tanque is 'Tanque que lo recibió: id de combustible_tanques_config.';
comment on column public.devoluciones_tanque.litros is 'Litros declarados por quien hizo la operación, no medidos por la regla.';

create index if not exists dt_fecha_idx  on public.devoluciones_tanque (fecha);
create index if not exists dt_cam_idx    on public.devoluciones_tanque (cam);
create index if not exists dt_tanque_idx on public.devoluciones_tanque (tanque);

alter table public.devoluciones_tanque enable row level security;

-- Mismo criterio que `salidas_tanque`: lo ve quien entra; lo escribe operativo o
-- superadmin, y nunca quien tiene acceso de solo consulta.
drop policy if exists dt_sel on public.devoluciones_tanque;
create policy dt_sel on public.devoluciones_tanque for select using (true);

drop policy if exists dt_ins on public.devoluciones_tanque;
create policy dt_ins on public.devoluciones_tanque for insert
  with check ((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()));

drop policy if exists dt_upd on public.devoluciones_tanque;
create policy dt_upd on public.devoluciones_tanque for update
  using     ((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()))
  with check((app_rol() = any (array['operativo','superadmin'])) and (not app_solo_lectura()));

drop policy if exists dt_del on public.devoluciones_tanque;
create policy dt_del on public.devoluciones_tanque for delete
  using (app_puede_borrar() and (not app_solo_lectura()));

grant select, insert, update, delete on public.devoluciones_tanque to authenticated;

-- ⛔ LA TABLA NACE ABIERTA A `anon` Y NO ES POR ESTE ARCHIVO: el esquema tiene
--    privilegios por omisión que se los dan a toda tabla nueva. Medido al crearla:
--    `anon` quedó con 4 permisos sin que nadie se los concediera, y como `dt_sel` es
--    `using (true)`, eso dejaba LEER todo el movimiento de combustible con la llave
--    pública del HTML. Se cierra a mano, igual que está `salidas_tanque`.
--    Es la misma forma que [[norma-toda-funcion-nace-abierta-a-public]], con tablas.
revoke all on public.devoluciones_tanque from anon;
