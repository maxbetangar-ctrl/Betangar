-- ══════════════════════════════════════════════════════════════════════════════
-- EL BLOQUEO DEL CHOFER DEJA RASTRO, Y EL INFORME DICE LA CAUSA DE CADA FALLA
--
-- Máximo, 16/11/2026: «¿hay forma de estimar cuáles fallas y cuántas han sido por
-- fallas del sistema y cuántas porque realmente ellos no lo hicieron o tipearon
-- mal los datos? Lo primero que van a decir cuando no cerraron un día es que el
-- sistema no los dejó».
--
-- ── 🔴 LO QUE SE ENCONTRÓ MIDIENDO, Y ES LA RAZÓN DE LA PRIMERA MITAD ─────────
--
-- La pieza que avisa «un chofer tocó Guardar y no quedó nada» existe en
-- `chofer.html` desde el 19/08 y **en Betangar nunca salió ni una vez**. En la
-- línea 4658 llama a `enqueueWA(...)`, que está definida en las otras cuatro
-- instancias y NO EXISTE en Betangar (una sola aparición en todo el repo: la del
-- call site). La llamada tira ReferenceError, se la come el `catch(e){}`, el
-- aviso queda en la cola del teléfono y a la medianoche
-- `if(COLA_BLOQ[i].fecha!==hoy) continue` lo descarta sin mandarlo.
--
-- Medido con CONTROL POSITIVO, porque un cero no se cree solo: `cola_mensajes`
-- con tipo='bloqueo' = 0 filas, mientras la misma tabla tiene 163 'latido', 135
-- 'gps_apagon' y 121 'cierre-checklist' con filas de hoy. La tabla funciona; el
-- cero es real. [[norma-control-positivo-antes-de-creerle-al-vacio]]
--
-- ⛔ Y PORTAR `enqueueWA` DE FLOTILLA TAL CUAL HABRÍA FALLADO IGUAL, EN SILENCIO.
--    Allá hace un `insert` directo en `cola_mensajes`. Acá se midió:
--    `anon` NO TIENE NI UN GRANT sobre esa tabla y las cuatro políticas son de
--    `authenticated` — y el chofer entra por QR, con la llave `anon`. El insert
--    habría dado 401 dentro del mismo `catch` vacío. Betangar cerró las
--    escrituras del chofer a RPC el 15/08 y esta tiene que ir por el mismo
--    camino. [[norma-probar-el-camino-no-la-pieza]]
--
-- ── LO QUE CAMBIA ─────────────────────────────────────────────────────────────
--
--  1. `chofer_bloqueos`: una fila por INTENTO fallido. El dato que hoy no existe.
--  2. `chofer_bloqueo_registrar(jsonb)`: la RPC que el teléfono puede llamar.
--  3. `btg_informe_llenado`: cada día sin cerrar sale con su CAUSA y su PRUEBA.
--
-- ⛔ EL RASTRO SE GUARDA SIEMPRE; EL AVISO SE RACIONA. Hoy el cliente solo habla
--    en el 2º intento y después uno de cada 5 — razonable para no saturar el
--    canal, pero eso significa que **el 1er intento no deja nada**, y el informe
--    necesita todos. Así que el teléfono registra CADA intento y es el SERVIDOR
--    el que decide cuándo escribir por WhatsApp. Evidencia completa, avisos
--    racionados. [[norma-un-aviso-que-salta-siempre-no-avisa-de-nada]]
--
-- ⛔ Y EL RASTRO DE AYER NO SE DESCARTA. La regla «lo de ayer no se manda hoy»
--    está bien para el AVISO —mandar a alguien a buscar un problema que ya pasó—
--    pero tira justo el caso que más importa: el chofer que estuvo sin señal
--    TODO el día, que es el único que de verdad puede decir «no me dejó». Acá la
--    fila se guarda igual y solo el aviso se calla.
--
-- ⚠️ LO QUE ESTO NO PUEDE DECIR, Y VIAJA EN `advertencias`: los tres
--    discriminadores que ya se podían calcular REFUTAN la excusa, no la
--    confirman. Prueban «no fue el sistema». Hasta que esta tabla tenga semanas
--    de historia, «sí fue el sistema» solo se puede CONFIRMAR hacia adelante.
--    Y nada guarda la historia de las caídas: `health_check` es una sola fila
--    que se pisa con upsert. [[norma-falta-de-dato-no-es-un-dato]]
-- ══════════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. LA TABLA ──────────────────────────────────────────────────────────────
-- ⛔ DOS RELOJES, A PROPÓSITO. `ocurrido_at` lo declara el TELÉFONO (cuándo se
--    trabó) y `registrado_at` lo pone el SERVIDOR (cuándo pudo contarlo). La
--    diferencia entre los dos ES la prueba de cuánto estuvo sin poder hablar: con
--    un solo reloj, un bloqueo de 7 horas sin señal se ve igual que uno de ahora.
create table if not exists public.chofer_bloqueos (
  id             bigserial primary key,
  fecha          text        not null,   -- la del NEGOCIO, la que declara el teléfono
  cam            text        not null,
  conductor      text,
  -- ⛔ `modo` E `intento` VAN NOT NULL CON DEFAULT, y es por el índice de abajo:
  --    así la llave única se arma con columnas planas en vez de con
  --    `coalesce(...)`. Un índice de expresiones obliga a que el `on conflict`
  --    repita la expresión EXACTA, y si no calza Postgres no deduplica: levanta
  --    «no unique or exclusion constraint matching». Eso no se ve escribiendo la
  --    migración —se ve recién al correrla—, y la función que la usa es la última
  --    línea de un chofer que ya no puede guardar. Se saca el riesgo, no se
  --    documenta. El valor por omisión no inventa un dato: lo pone la función
  --    cuando el teléfono manda algo que no es 'salida' ni 'llegada'.
  modo           text        not null default '',   -- 'salida' | 'llegada' | ''
  intento        int         not null default 0,    -- el n-ésimo de ese día en ese teléfono
  pantalla_dijo  text,                   -- lo último que la pantalla le mostró
  turno          text,
  ocurrido_at    timestamptz not null,
  registrado_at  timestamptz not null default now()
);

comment on table public.chofer_bloqueos is
  'Un intento de guardar el checklist que NO quedo registrado: la prueba de que el sistema (o un candado) freno al chofer. La escribe chofer_bloqueo_registrar() desde el telefono. Antes del 16/11/2026 este dato NO EXISTIA: la unica pieza que lo avisaba llamaba a una funcion que en Betangar no existe, y nunca salio ni una vez.';
comment on column public.chofer_bloqueos.ocurrido_at is
  'Cuando se trabo, segun el TELEFONO. Comparado con registrado_at dice cuanto estuvo sin poder avisar.';
comment on column public.chofer_bloqueos.registrado_at is
  'Cuando la fila llego al servidor. Lo pone el servidor, no el telefono.';
comment on column public.chofer_bloqueos.pantalla_dijo is
  'Lo ultimo que la pantalla le mostro al chofer. Es lo que convierte «no me deja» en un diagnostico sin ir a preguntar. Vacio significa que se trabo MUDO, que es peor.';

-- ⛔ LA COLA DEL TELÉFONO REINTENTA: sin esto, un bloqueo que tarda tres vueltas
--    en subir se cuenta tres veces y el informe exagera a favor del chofer.
create unique index if not exists chofer_bloqueos_unico
  on public.chofer_bloqueos (cam, fecha, modo, intento);

create index if not exists chofer_bloqueos_fecha on public.chofer_bloqueos (fecha);

-- ⛔ CERRADA A LAS DOS LLAVES. Se escribe y se lee SOLO por funciones `definer`:
--    la tabla no necesita estar abierta a nadie, y una tabla nueva en `public`
--    nace con los grants por omisión de Supabase si no se los quita a mano.
--    [[norma-toda-funcion-nace-abierta-a-public]]
alter table public.chofer_bloqueos enable row level security;
revoke all on public.chofer_bloqueos from anon, authenticated;
revoke all on sequence public.chofer_bloqueos_id_seq from anon, authenticated;

-- ── 2. LA PUERTA DEL TELÉFONO ────────────────────────────────────────────────
-- ⛔ `security definer` porque `anon` no tiene —ni va a tener— permiso sobre la
--    tabla ni sobre `cola_mensajes`. Es el mismo camino que las otras escrituras
--    del chofer desde el 15/08.
create or replace function public.chofer_bloqueo_registrar(p jsonb)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' as $fn$
declare
  v_fecha   text := nullif(btrim(coalesce(p->>'fecha','')), '');
  v_cam     text := nullif(btrim(coalesce(p->>'cam','')), '');
  v_modo    text := lower(nullif(btrim(coalesce(p->>'modo','')), ''));
  -- ⛔ NO SE CASTEA EN EL `declare`: una excepción acá cae FUERA de todo manejo
  --    —los bloques `exception` del cuerpo no cubren la inicialización de las
  --    variables— y la función moriría con un error de Postgres justo cuando es
  --    el último rastro de un chofer que ya no puede guardar. Se parsea abajo.
  v_intento int;
  v_dijo    text := left(nullif(btrim(coalesce(p->>'pantalla_dijo','')), ''), 300);
  v_ocurr   timestamptz;
  v_hoy     text := to_char((now() at time zone 'America/Caracas')::date, 'YYYY-MM-DD');
  v_tel     text;
  v_guardo  boolean := false;
  v_aviso   boolean := false;
begin
  -- ⛔ SE EXIGE LO MÍNIMO Y NADA MÁS. Esta función es el último rastro de un
  --    chofer que ya no puede guardar: si se planta por un campo de adorno, el
  --    silencio que vino a romper vuelve entero.
  if v_cam is null or v_fecha is null then
    raise exception 'cam y fecha son obligatorios para registrar un bloqueo';
  end if;
  if v_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'la fecha tiene que venir como AAAA-MM-DD, llego: %', v_fecha;
  end if;
  if v_modo is not null and v_modo not in ('salida','llegada') then
    v_modo := null;   -- un modo raro no tira la fila: se guarda sin modo
  end if;

  -- Un `intento` que no es un número no tira la fila: vale 0 y la fila entra.
  begin
    v_intento := nullif(btrim(coalesce(p->>'intento','')), '')::int;
  exception when others then v_intento := 0;
  end;
  if v_intento is null or v_intento < 0 then v_intento := 0; end if;

  -- El reloj del teléfono puede venir en cualquier estado. Si no sirve, se usa
  -- el del servidor — pero NUNCA se inventa uno anterior a la fecha declarada.
  begin
    v_ocurr := (p->>'ocurrido_at')::timestamptz;
  exception when others then v_ocurr := null;
  end;
  if v_ocurr is null or v_ocurr > now() + interval '1 day' then v_ocurr := now(); end if;

  insert into public.chofer_bloqueos
    (fecha, cam, conductor, modo, intento, pantalla_dijo, turno, ocurrido_at)
  values
    (v_fecha, v_cam, nullif(btrim(coalesce(p->>'conductor','')), ''),
     coalesce(v_modo,''), coalesce(v_intento,0), v_dijo,
     nullif(btrim(coalesce(p->>'turno','')), ''), v_ocurr)
  on conflict (cam, fecha, modo, intento) do nothing;

  v_guardo := FOUND;

  -- ── El aviso, racionado y SOLO del día de hoy ──────────────────────────────
  -- El 1er intento casi siempre es el chofer corrigiéndose solo. Del 2º en
  -- adelante ya no: 2º, y después uno de cada 5. Es la regla que la casa ya
  -- eligió para esto, y ahora la aplica el servidor y no cinco clientes.
  if v_guardo and v_fecha = v_hoy and coalesce(v_intento,0) >= 2
     and (v_intento = 2 or v_intento % 5 = 0) then

    -- ⛔ EL DESTINO NO SE ESCRIBE ACÁ. Sale de `latidos`, que es de donde lo
    --    saca el resto de la casa: un número puesto a mano en una función es un
    --    destinatario por omisión, o sea una fuga el día que cambia.
    --    [[norma-un-destinatario-por-omision-es-una-fuga]]
    select public.tel_para_escribir(destino) into v_tel
      from latidos where nombre = 'soporte-sla';

    if v_tel is not null then
      insert into cola_mensajes (tipo, telefono, mensaje, estado, ref)
      select 'bloqueo', v_tel,
        '🔴 ' || replace(v_cam, 'JAC-', '') || ' · ' ||
        coalesce(nullif(btrim(coalesce(p->>'conductor','')), ''), 'sin chofer') ||
        ' NO PUEDE GUARDAR el checklist (' ||
        upper(coalesce(v_modo, 'sin modo')) || ')' || chr(10) ||
        'Lleva ' || v_intento || ' intentos y no queda registrado.' || chr(10) ||
        'La pantalla le dice: ' ||
        coalesce(v_dijo, 'NADA — se traba sin decir por qué') || chr(10) || chr(10) ||
        'Área de Servicio Técnico — Maxware',
        'pendiente',
        'bloqueo:' || v_cam || ':' || v_fecha || ':' || v_intento
      where not exists (
        select 1 from cola_mensajes m
         where m.ref = 'bloqueo:' || v_cam || ':' || v_fecha || ':' || v_intento);
      v_aviso := FOUND;
    end if;
  end if;

  -- ⛔ SE LE CONTESTA AL TELÉFONO SI QUEDÓ GUARDADO. Sin esto el cliente no sabe
  --    si puede sacarlo de su cola, y un «ya lo conté» falso pierde el rastro.
  return jsonb_build_object('guardado', v_guardo, 'aviso', v_aviso);
end $fn$;

comment on function public.chofer_bloqueo_registrar(jsonb) is
  'Registra UN intento de guardar el checklist que no quedo registrado, y decide si corresponde avisar por WhatsApp (2do intento y despues uno de cada 5, solo del dia de hoy). El rastro se guarda siempre, aunque el aviso no corresponda: es la unica prueba de que el sistema freno al chofer. Devuelve {guardado, aviso}.';

revoke all on function public.chofer_bloqueo_registrar(jsonb) from public;
grant execute on function public.chofer_bloqueo_registrar(jsonb) to anon, authenticated;

commit;
