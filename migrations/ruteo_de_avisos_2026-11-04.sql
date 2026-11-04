-- ═══════════════════════════════════════════════════════════════════════════════
-- CADA AVISO A SU CANAL — 2026-11-04
--
-- Máximo, 04/11/2026: «los reportes de reclamos de servicio técnico que no me
-- lleguen más a mí sino a Alejandra» · «pongamos todos los reportes en uno y solo
-- los que sean relevantes en el otro número, aprovecha que tengo 2, porque está
-- como el cuento del lobo: me llegan tantos mensajes que no miro jamás ese chat y
-- cuando sea importante no lo voy a ver».
--
-- 🔴 MEDIDO ANTES DE TOCAR, sobre `cola_mensajes`, 30 días:
--    **775 mensajes a 584147379886 = 25,8 por día.** 29 tipos distintos. Los seis
--    más ruidosos (gps_reenvio 161, bnc 90, cobros 83, auditoria 77, alerta 60,
--    latido 54) son el 70% del volumen. Un aviso que salta siempre no avisa de
--    nada. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
--
-- LA DECISIÓN, de Máximo, con los números delante:
--    · +58 414 737 9886 (Venezuela) = CANAL LIMPIO, solo lo que exige que haga algo
--    · +57 301 750 9763 (Colombia)  = TODO lo demás
--    · Alejandra (5219512180813)    = los reportes de servicio técnico
--
-- ⛔ NO SE TOCAN 68 CRONES. Cada fila de la cola ya trae su `tipo`: el ruteo es UNA
--    tabla y UN trigger en la puerta por la que pasan todos. Arreglar emisor por
--    emisor garantiza que el próximo lo vuelva a romper.
--    [[norma-arreglar-el-mecanismo-no-el-caso]]
--
-- ⛔ LO QUE NO SE RUTEA SE DEJA EXACTAMENTE COMO ESTÁ. Un tipo que no esté en la
--    tabla sigue yendo a donde va hoy — al canal limpio — y aparece en
--    `btg_avisos_sin_rutear()`. El modo de fallar es que Máximo vea de más, nunca
--    que algo se entierre callado en el canal que no mira.
--    [[norma-falta-de-dato-no-es-un-dato]]
--
-- ⛔ Y POR ESO `soporte-respuesta`, `soporte-programado` y `soporte-charla` NO VAN A
--    ALEJANDRA. Se midió: tienen 20, 14 y 2 destinatarios distintos — son las
--    RESPUESTAS a quien escribió, no reportes. Mandarlas a Alejandra sería mandarle
--    las conversaciones de otras personas. Los siete que sí son reportes tienen UN
--    solo destino: Máximo. [[norma-un-destinatario-por-omision-es-una-fuga]]
--
-- ⚠️ ALCANCE: esto cubre todo lo que pasa por `cola_mensajes`. Las alarmas de la PC
--    (`maxware-tools/avisar-whatsapp.mjs`) escriben derecho a Wassenger con
--    `AVISAR_A` fijo y NO pasan por acá — pero son avisos de que algo se rompió, o
--    sea canal limpio, que es donde ya caen. Si alguna vez dejan de serlo, hay que
--    hacerlas leer esta misma tabla.
--
-- ⛔ REVERSIBLE: el UNDO está al final; borra el trigger y las dos tablas.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) Los canales: a qué teléfono va cada uno ─────────────────────────────────
create table if not exists public.avisos_canal (
  canal      text primary key,
  telefono   text not null check (telefono ~ '^[0-9]{11,15}$'),
  nota       text,
  updated_at timestamptz not null default now()
);

comment on table public.avisos_canal is
  'A que telefono va cada canal de avisos. Cambiar un numero aca lo cambia para TODOS los tipos de ese canal, sin tocar codigo.';

insert into public.avisos_canal (canal, telefono, nota) values
  ('limpio',  '584147379886', 'Maximo - Venezuela. SOLO lo que exige que haga algo. Si esto se llena, el canal deja de servir.'),
  ('todo',    '573017509763', 'Maximo - Colombia. Todo lo demas: el registro completo, para consultar, no para vigilar.'),
  ('soporte', '5219512180813', 'Alejandra (Virginia Alejandra Castillo, E975). Los reportes de servicio tecnico.')
on conflict (canal) do update
  set telefono = excluded.telefono, nota = excluded.nota, updated_at = now();

-- ── 2) Qué tipo va a qué canal ─────────────────────────────────────────────────
create table if not exists public.avisos_ruta (
  tipo       text primary key,
  canal      text not null references public.avisos_canal(canal),
  nota       text,
  updated_at timestamptz not null default now()
);

comment on table public.avisos_ruta is
  'Que tipo de aviso va a que canal. Un tipo que NO este aca no se toca: sigue yendo a donde va hoy, y lo lista btg_avisos_sin_rutear().';

insert into public.avisos_ruta (tipo, canal, nota) values
  -- ── LIMPIO: exige una decision o una accion de Maximo ──
  ('vigilante',             'limpio',  'Mensajes que NO salieron. 42 en 30 dias.'),
  ('cobros',                'limpio',  'Cobro de la Alcaldia que no ha caido. 83 en 30 dias -- repite el mismo aviso: hay que agruparlo.'),
  ('bnc_traer_error',       'limpio',  'No se pudo traer el estado de cuenta.'),
  ('supervision',           'limpio',  'Supervision de nomina.'),
  ('resumen_acuse',         'limpio',  'El resumen a los socios NO salio.'),
  ('fiscal',                'limpio',  'Vencimiento de declaracion.'),
  ('auditoria_mensual',     'limpio',  'Cierre mensual de informes.'),
  ('resumen_socios',        'limpio',  'Su copia del informe a los socios.'),
  -- ── TODO: el registro completo, al numero de Colombia ──
  ('gps_reenvio',           'todo',    '161 en 30 dias. El mas ruidoso de todos.'),
  ('gps_apagon',            'todo',    '40 en 30 dias.'),
  ('gps_vigilante',         'todo',    ''),
  ('bnc',                   'todo',    'Cada pago que entra al banco. 90 en 30 dias.'),
  ('auditoria',             'todo',    'Auditoria diaria. 77 en 30 dias.'),
  ('alerta',                'todo',    'Alertas diarias. 60 en 30 dias.'),
  ('latido',                'todo',    'Latidos de las tareas. 54 en 30 dias.'),
  ('app',                   'todo',    'Avisos de la app (planillas duplicadas, nombres no reconocidos).'),
  ('km_semanal',            'todo',    ''),
  ('choferes-dia',          'todo',    ''),
  ('divisas',               'todo',    'El banco compro dolares.'),
  ('prueba-programado',     'todo',    'Pruebas tecnicas.'),
  -- ── SOPORTE -> ALEJANDRA: reportes, los 7 que tienen UN solo destino ──
  ('soporte-resumen',       'soporte', 'Resumen del dia de soporte. 30 en 30 dias.'),
  ('soporte-parte',         'soporte', 'Parte del dia de servicio tecnico. 30 en 30 dias.'),
  ('soporte-escala',        'soporte', 'Escalacion de un caso. 11 en 30 dias.'),
  ('soporte-sin-responder', 'soporte', 'Alguien escribio y no tiene respuesta. 9 en 30 dias.'),
  ('soporte-adjunto-perdido','soporte','Adjuntos que no se pudieron bajar. 9 en 30 dias.'),
  ('soporte-aviso',         'soporte', 'Aviso de un caso nuevo. 7 en 30 dias.'),
  ('soporte-rafaga',        'soporte', 'Alguien mando varios mensajes seguidos. 2 en 30 dias.')
on conflict (tipo) do update
  set canal = excluded.canal, nota = excluded.nota, updated_at = now();

-- ── 3) La puerta ───────────────────────────────────────────────────────────────
-- ⚠️ El nombre del trigger EMPIEZA POR `r` a proposito: los triggers del mismo
--    momento corren en orden alfabetico, y `trg_cola_normalizar_tel` (la puerta que
--    canoniza el numero) tiene que correr ANTES. Si este corriera primero, aquel le
--    pisaria el destino.
create or replace function public.cola_rutear_aviso() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  v_maximo text;
  v_destino text;
begin
  select telefono into v_maximo from public.avisos_canal where canal = 'limpio';
  -- Solo se rutea lo que va a Maximo. Lo de cualquier otra persona, intacto.
  if right(regexp_replace(coalesce(new.telefono,''), '\D', '', 'g'), 10)
     <> right(coalesce(v_maximo,''), 10) then
    return new;
  end if;
  select c.telefono into v_destino
    from public.avisos_ruta r
    join public.avisos_canal c on c.canal = r.canal
   where r.tipo = new.tipo;
  -- Sin ruta declarada: NO SE TOCA. Sigue yendo al canal limpio, que es el que mira.
  if v_destino is null then return new; end if;
  if regexp_replace(coalesce(new.telefono,''), '\D', '', 'g') = v_destino then
    return new;
  end if;
  new.telefono_pedido := coalesce(new.telefono_pedido, new.telefono);
  new.telefono := v_destino;
  return new;
end;
$$;

drop trigger if exists trg_cola_rutear_aviso on public.cola_mensajes;
create trigger trg_cola_rutear_aviso
  before insert on public.cola_mensajes
  for each row execute function public.cola_rutear_aviso();

-- ── 4) Lo que todavia no tiene canal ───────────────────────────────────────────
-- Un tipo sin ruta no se pierde: sigue cayendo en el canal limpio y aparece aca
-- para que alguien decida. Un filtro que descarta en silencio se ve igual que un
-- dato que no llego. [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]
create or replace function public.btg_avisos_sin_rutear(p_dias int default 30)
returns table (tipo text, veces bigint, ultimo timestamptz, ejemplo text)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(c.tipo,'(sin tipo)'), count(*), max(c.created_at),
         left(min(c.mensaje), 80)
    from public.cola_mensajes c
   where c.created_at > now() - make_interval(days => p_dias)
     and right(regexp_replace(coalesce(c.telefono,''), '\D', '', 'g'), 10)
         = (select right(telefono,10) from public.avisos_canal where canal='limpio')
     and not exists (select 1 from public.avisos_ruta r where r.tipo = c.tipo)
   group by 1
   order by 2 desc;
$$;

revoke all on function public.btg_avisos_sin_rutear(int) from public, anon;
grant execute on function public.btg_avisos_sin_rutear(int) to authenticated, service_role;
revoke all on table public.avisos_canal, public.avisos_ruta from public, anon;

-- ── Comprobacion ───────────────────────────────────────────────────────────────
select r.canal, c.telefono, count(*) tipos,
       string_agg(r.tipo, ', ' order by r.tipo) cuales
  from public.avisos_ruta r join public.avisos_canal c on c.canal = r.canal
 group by 1,2 order by 1;

-- ═══════════════════════════════════════════════════════════════════════════════
-- UNDO
--   drop trigger if exists trg_cola_rutear_aviso on public.cola_mensajes;
--   drop function if exists public.cola_rutear_aviso();
--   drop function if exists public.btg_avisos_sin_rutear(int);
--   drop table if exists public.avisos_ruta;
--   drop table if exists public.avisos_canal;
-- ═══════════════════════════════════════════════════════════════════════════════
