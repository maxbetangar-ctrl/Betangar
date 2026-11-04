-- BETANGAR — PUNTOS DE REFERENCIA en el mapa, sacados de lo que YA tenemos
-- Fecha: 2026-10-30
--
-- ⛔ POR QUÉ EXISTE. Los choferes dijeron que el mapa les cuesta porque **no tiene puntos
--    de referencia**: ven las calles pero no reconocen dónde están. Máximo preguntó si
--    conviene pagar el mapa de Google.
--    La respuesta medida: **ya tenemos las referencias y no cuestan nada.** El proveedor
--    del GPS geocodifica cada posición y eso se guarda en `gps_posiciones.ubicacion`
--    desde agosto —319.843 filas con dato—. Ahí están «LOCATEL LA LIMPIA», «MANGO
--    BAJITO», «Hospital Coromoto», «Clínica Los Olivos», «Mercasa». Nadie las usaba.
--
-- 📏 MEDIDO el 30/10/2026: 1.232 etiquetas distintas → **230 puntos** dentro de las
--    parroquias que atendemos. Reparto: Olegario Villalobos 166 · Santa Lucía 37 ·
--    Caracciolo Parra Pérez 18 · Venancio Pulgar 9.
--    ⚠️ **Caracciolo, de donde vino la queja, es la que menos tiene.** El geocodificador
--    conoce muchos más comercios en Olegario. Esto ayuda, y ayuda MENOS donde más se
--    necesita: no se vende como solución completa.
--
-- ── LOS TRES CANDADOS, y por qué cada uno ────────────────────────────────────
--
-- 1. SOLO EL TROZO ANTES DE LA PRIMERA COMA. El proveedor devuelve «E/S El Palotal 1
--    (SUB), Carretera Regional San Francisco - La Concepción, Parroquia ..., Venezuela».
--    El lugar es lo primero; el resto es la dirección y no sirve de etiqueta.
--
-- 2. FUERA LO QUE NO ES UN LUGAR:
--    · basura del geocodificador: **«False», 205 veces**. También null, None, guiones.
--    · áreas: «Parroquia Caracciolo Parra Pérez» aparece **16.819 veces** — no es un
--      punto, es toda la parroquia; puesta como pin taparía el mapa.
--    · nombres de calle: ya están dibujados como calles. ⚠️ Incluidas las abreviadas
--      («Av. 16», «AV 2C», «Av. 13A»), que se colaron en la primera versión del filtro.
--    · códigos de vía tipo «R-79».
--
-- 3. ⛔ EL CANDADO QUE IMPORTA: LA DISPERSIÓN. Un lugar de verdad tiene sus posiciones
--    JUNTAS. «Víveres D'Candido La Lago» da 0,00007 grados (~8 m): es un punto.
--    «Banco Nacional de Crédito» da **0,0209 (~2,3 km)**: son varias sucursales
--    promediadas en una coordenada **donde no hay nada**. Igual «Mercantil» (0,024),
--    «De Candido Express» (0,013) y «Transmaracaibo» (0,019).
--    Tope: **0,002 grados ≈ 220 m**. Entra un edificio grande (el Retén de El Marite da
--    0,00135) y queda afuera un barrio.
--    ⚠️ Un promedio de un conjunto disperso es un dato INVENTADO: no es un lugar menos
--    preciso, es un lugar que no existe. [[norma-respaldo-que-inventa-un-dato]]
--
-- ⛔ LOS BARRIOS QUEDAN AFUERA Y NO ES UN OLVIDO. «El Saladillo» (0,0091), «Iragorri»,
--    «Urbanización Sucre» sí le sirven a un chofer para ubicarse — pero como ÁREA
--    sombreada con el nombre en el medio, no como un pin en su centro geométrico, que
--    cae en una esquina cualquiera. Eso es otra pieza; se anota, no se improvisa.
--
-- ⚠️ EL DESCARTE SE ESCRIBE. La tabla guarda también los descartados, con el motivo, en
--    `descartado`. Un filtro nuestro que calla se lee igual que un dato que no llega, y
--    sin esto nadie podría rescatar a mano uno que valga la pena.
--    [[norma-un-filtro-nuestro-tapa-un-dato-que-si-llega]]

begin;

create table if not exists public.puntos_referencia (
  nombre      text primary key,
  lat         double precision not null,
  lon         double precision not null,
  veces       integer not null,                 -- cuántas posiciones nuestras lo nombraron
  dispersion  numeric not null,                 -- grados; > 0,002 = no es un punto
  parroquia   text,                             -- la nuestra en que cae, o NULL
  descartado  text,                             -- NULL = se muestra. Si no, el motivo.
  calculado   timestamptz not null default now()
);

comment on table public.puntos_referencia is
  'Lugares que los choferes reconocen, para orientarse en el mapa. Salen del geocodificador '
  'del PROVEEDOR del GPS (`gps_posiciones.ubicacion`), que ya los venía guardando: no se le '
  'paga nada a nadie por esto. ⛔ `descartado` no es basura: es el filtro diciendo en voz '
  'alta qué sacó y por qué, para poder rescatar a mano lo que valga.';
comment on column public.puntos_referencia.dispersion is
  'Desvío de las posiciones que llevan ese nombre, en grados. Un lugar real da ~0,0002 '
  '(20 m). Arriba de 0,002 (220 m) es una cadena de sucursales o un barrio, y su promedio '
  'es una coordenada donde no hay nada: se descarta, no se dibuja impreciso.';

create index if not exists puntos_referencia_mostrables
  on public.puntos_referencia (parroquia) where descartado is null;

-- ── Recalcular: se puede correr cuantas veces se quiera ─────────────────────
create or replace function public.puntos_referencia_recalcular(p_min_veces integer default 5)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with et as (
    select btrim(split_part(ubicacion, ',', 1)) nombre, lat, lon
      from gps_posiciones
     where ubicacion is not null and btrim(split_part(ubicacion, ',', 1)) <> ''
  ), ag as (
    select nombre, avg(lat) lat, avg(lon) lon, count(*) veces,
           greatest(coalesce(stddev_pop(lat), 0), coalesce(stddev_pop(lon), 0)) disp
      from et group by nombre having count(*) >= p_min_veces
  ), juzgado as (
    select ag.*,
      case
        when nombre in ('False','false','null','None','-','Maracaibo','Venezuela','Zulia')
          then 'basura del geocodificador'
        when nombre ~* '^(parroquia|municipio|estado|zulia|venezuela)\M'
          then 'es un area, no un punto'
        when nombre ~* '^(avenida|calle|carretera|autopista|troncal|prolongacion|redoma)\M'
          or nombre ~* '^(av|c|cl|via)[\s.]'
          then 'es una calle: ya esta dibujada'
        when nombre ~* '^[A-Z]{1,3}[-\s]?[0-9]+$'
          then 'codigo de via'
        when length(nombre) < 4 or length(nombre) > 60
          then 'nombre inservible por largo'
        when disp > 0.002
          then 'disperso ' || round(disp::numeric, 4) || ' grados: cadena o barrio, su promedio no existe'
        else null
      end motivo
      from ag
  )
  insert into puntos_referencia (nombre, lat, lon, veces, dispersion, parroquia, descartado, calculado)
  select j.nombre, j.lat, j.lon, j.veces, round(j.disp::numeric, 6),
         (select pa.nombre from parroquias pa
           where pa.es_nuestra and _punto_en_poligono(j.lat, j.lon, pa.poligono) limit 1),
         j.motivo, now()
    from juzgado j
  on conflict (nombre) do update set
    lat = excluded.lat, lon = excluded.lon, veces = excluded.veces,
    dispersion = excluded.dispersion, parroquia = excluded.parroquia,
    descartado = excluded.descartado, calculado = excluded.calculado;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.puntos_referencia_recalcular(integer) is
  'Rearma `puntos_referencia` desde `gps_posiciones.ubicacion`. Idempotente: se puede '
  'correr cuantas veces se quiera. `p_min_veces` es el piso de apariciones (5 por omision): '
  'un lugar que el geocodificador nombro UNA vez puede ser un error suyo.';

-- ── Permisos: la app LEE, nadie escribe desde afuera ────────────────────────
alter table public.puntos_referencia enable row level security;
revoke all on public.puntos_referencia from anon;
grant select on public.puntos_referencia to authenticated;

create policy puntos_referencia_sel on public.puntos_referencia
  for select to authenticated
  using ( app_rol() = any(array['superadmin','admin','operador','visualizador','directivo',
                                'auditor','revisor','operativo','mecanico','rrhh']) );

revoke all on function public.puntos_referencia_recalcular(integer) from anon;

commit;

-- Primera carga.
select public.puntos_referencia_recalcular();

-- ── VERIFICAR DESPUÉS DE CORRER ──────────────────────────────────────────────
-- select parroquia, count(*) from puntos_referencia
--   where descartado is null and parroquia is not null group by 1 order by 2 desc;
--   → Olegario 166 · Santa Lucia 37 · Caracciolo 18 · Venancio Pulgar 9 (al 30/10/2026)
--
-- ⛔ Y MIRAR LO DESCARTADO, que es la mitad del control:
-- select nombre, veces, dispersion, descartado from puntos_referencia
--   where descartado is not null order by veces desc limit 20;
--   → tiene que sacar «False», «Parroquia ...», «Av. 16», «Banco Nacional de Credito».
--   Si ahi aparece algo que SI es un lugar util, se rescata subiendole el tope o a mano.
--
-- ⚠️ La tabla NO se refresca sola. Conviene recalcular cada tanto (semanal alcanza: los
--    comercios no se mudan todas las noches), y despues de cargar una parroquia nueva.
