-- ════════════════════════════════════════════════════════════════════════════
--  LA ZONA DE TRABAJO DE VENANCIO PULGAR: donde los camiones DE VERDAD pasaron.
--
--  PEDIDO (Maximo, 23/10/2026): «elimina las zonas rurales, solo delimita en
--  Venancio las que has visto y verificado que cubren mis camiones, asi es mas
--  real». El criterio es suyo y es mejor que el que yo habia propuesto: el area
--  real no es donde hay calles, es donde estuvo el camion.
--
--  LO MEDIDO. El limite legal de Venancio son 71,5 km2. Los camiones han tocado
--  8,3 km2 (el 12 %). Cerrando el hueco entre calles paralelas —que es manzana
--  trabajada, no campo— y recortando contra el limite legal, la zona queda en
--  11,66 km2: UN SEXTO del limite legal.
--      · 48.719 posiciones en 840 celdas de ~100 m
--      · hay celdas vistas en 53 dias distintos; solo 87 celdas (10 %) se vieron
--        un solo dia. No es la foto de una jornada.
--      · 3 piezas: la principal de 11,21 km2 y dos sectores de 0,28 y 0,17.
--        Se descarto una mota de 0,15 km2: una pasada de transito no es zona.
--      · el recorte contra el limite legal hace falta porque las celdas del
--        borde sobresalen hasta ~70 m aunque su centro caiga adentro.
--
--  ⛔ Y ES SOLO VENANCIO. Medido en las cuatro, contra el limite ya recortado por
--     la costa: Caracciolo 100 %, Olegario 98 %, Santa Lucia 94 %, Venancio 17 %.
--     En las otras tres los camiones cubren la parroquia entera y no habria nada
--     que recortar.
--
--  ⛔ EL LIMITE LEGAL NO SE TOCA. `poligono_oficial` (el que vale ante la Alcaldia)
--     y `poligono` (el legal recortado por la costa) quedan como estaban. Esto es
--     una TERCERA cosa y vive aparte.
--     [[norma-un-valor-derivado-depende-de-la-version-de-su-regla]]
--
--  ⚠️ PARA QUE SIRVE Y PARA QUE NO:
--     SI  → dibujar el contorno en el mapa y decidir EL ENCUADRE del dia.
--     NO  → recortar el recorrido dibujado (`soloLimpiado` en mapa.html), que sigue
--           usando `poligono`. Si recortaramos con la zona, una calle nueva que
--           empiecen a limpiar caeria FUERA y no se veria NUNCA: la zona se define
--           por donde fueron, y solo mostrariamos lo de adentro. Un circulo que se
--           cierra sobre si mismo y esconde trabajo real.
--
--  ⚠️ SE RECALCULA: la zona crece con la cobertura. Por eso se guarda CUANDO se
--     calculo y CON QUE evidencia.
-- ════════════════════════════════════════════════════════════════════════════

alter table parroquias add column if not exists poligono_zona jsonb;
alter table parroquias add column if not exists zona_calculada_en timestamptz;
alter table parroquias add column if not exists zona_evidencia jsonb;

comment on column parroquias.poligono_zona is
  'Donde los camiones DE VERDAD pasaron, derivado del GPS. Es una LISTA DE ANILLOS '
  '[[[lat,lon],...],...], no un anillo suelto. Sirve para dibujar y para encuadrar. '
  'NO se usa para recortar recorridos: para eso manda poligono, o una calle nueva '
  'quedaria fuera de la zona y no se veria nunca. Nulo = los camiones cubren la '
  'parroquia entera y no hay nada que recortar.';

comment on column parroquias.zona_evidencia is
  'Con que se calculo la zona: posiciones, celdas, dias y el cierre usado. Una zona '
  'derivada sin su evidencia no se puede volver a discutir ni rehacer.';

-- ── LA ZONA Y SUS CONTROLES, EN UN SOLO BLOQUE ──────────────────────────────
--  ⛔ La «foto de antes» se toma ACA ADENTRO. Es la unica forma honesta de probar
--     que esto no toco ningun limite legal, y no hace falta crear ni borrar nada.
--  ⚠️ Para eso NO sirve comparar `poligono` contra `poligono_oficial`: en Venancio
--     y en Caracciolo son el MISMO anillo empezando por OTRO vertice (254 puntos
--     los dos, el conjunto de vertices identico, 0 diferencias en ambos sentidos,
--     pero vertice contra vertice se van hasta 5 km). Un `=` ahi contesta «los
--     tocaron» y es mentira. [[norma-una-asercion-mal-escrita-acusa-al-producto]]
do $do$
declare uid text; k int; anillos int; afuera int; antes text; despues text;
begin
  select auth_user_id::text into uid from btg_usuarios
   where rol in ('superadmin','admin') and auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);

  select md5(string_agg(nombre || poligono::text || coalesce(poligono_oficial::text, ''),
                        '|' order by nombre))
    into antes from parroquias;

  update parroquias
     set poligono_zona = $z$[[[10.705841,-71.7246],[10.705505,-71.724353],[10.7055,-71.724349],[10.7055,-71.7237],[10.70463,-71.7237],[10.704553,-71.72364],[10.70439,-71.7235],[10.704227,-71.723353],[10.703779,-71.722942],[10.7037,-71.722864],[10.7037,-71.7228],[10.703636,-71.7228],[10.703525,-71.72269],[10.703367,-71.722519],[10.702996,-71.722092],[10.702848,-71.721912],[10.7028,-71.721841],[10.7028,-71.721],[10.702272,-71.721],[10.7019,-71.720392],[10.7019,-71.7192],[10.70118,-71.7192],[10.701,-71.718905],[10.701,-71.7183],[10.700628,-71.7183],[10.700339,-71.717833],[10.7001,-71.717426],[10.7001,-71.7165],[10.699556,-71.7165],[10.699501,-71.716406],[10.6992,-71.715893],[10.6992,-71.7147],[10.698501,-71.7147],[10.698431,-71.714579],[10.6983,-71.714324],[10.6983,-71.7138],[10.698031,-71.7138],[10.697986,-71.713707],[10.697706,-71.713061],[10.6974,-71.712407],[10.6974,-71.7111],[10.696834,-71.7111],[10.696792,-71.711001],[10.6965,-71.71034],[10.6965,-71.7093],[10.696051,-71.7093],[10.695869,-71.708893],[10.695656,-71.708381],[10.6956,-71.708242],[10.6956,-71.7066],[10.695209,-71.7066],[10.695163,-71.706364],[10.694997,-71.705572],[10.694762,-71.704344],[10.6947,-71.704089],[10.6947,-71.7021],[10.694075,-71.7021],[10.693948,-71.701814],[10.693808,-71.701474],[10.6938,-71.701452],[10.6938,-71.7003],[10.693309,-71.7003],[10.693281,-71.700237],[10.693062,-71.699696],[10.6929,-71.699359],[10.6929,-71.6985],[10.692508,-71.6985],[10.692227,-71.697904],[10.692084,-71.697611],[10.69207,-71.697444],[10.692,-71.697292],[10.692,-71.6958],[10.691665,-71.6958],[10.691563,-71.695747],[10.691396,-71.69454],[10.691299,-71.693846],[10.691238,-71.693358],[10.691157,-71.692451],[10.6911,-71.691907],[10.6911,-71.6859],[10.690494,-71.6859],[10.690429,-71.685735],[10.6902,-71.685227],[10.6902,-71.6841],[10.689702,-71.6841],[10.689691,-71.684077],[10.689509,-71.683755],[10.6893,-71.683374],[10.6893,-71.6823],[10.688702,-71.6823],[10.688694,-71.682285],[10.6884,-71.681765],[10.6884,-71.6805],[10.687927,-71.6805],[10.687933,-71.680241],[10.687955,-71.6796],[10.6884,-71.6796],[10.6884,-71.677582],[10.68853,-71.677506],[10.688778,-71.677357],[10.689433,-71.67698],[10.689556,-71.6769],[10.6902,-71.6769],[10.6902,-71.676496],[10.690435,-71.676366],[10.690769,-71.676178],[10.691049,-71.676033],[10.691108,-71.676],[10.692,-71.676],[10.692,-71.675499],[10.692224,-71.675371],[10.692345,-71.675285],[10.692472,-71.675183],[10.692551,-71.6751],[10.6929,-71.6751],[10.6929,-71.67463],[10.693212,-71.6742],[10.6938,-71.6742],[10.6938,-71.673402],[10.694501,-71.672452],[10.694539,-71.6724],[10.6947,-71.6724],[10.6947,-71.672178],[10.695191,-71.6715],[10.6956,-71.6715],[10.6956,-71.670932],[10.695658,-71.670851],[10.695685,-71.670701],[10.695779,-71.6706],[10.6965,-71.6706],[10.6965,-71.669772],[10.69676,-71.669456],[10.697002,-71.669127],[10.697111,-71.668893],[10.697216,-71.6688],[10.6974,-71.6688],[10.6974,-71.668633],[10.697596,-71.668445],[10.697783,-71.668239],[10.698075,-71.6679],[10.6983,-71.6679],[10.6983,-71.667643],[10.6988,-71.667096],[10.698886,-71.667],[10.6992,-71.667],[10.6992,-71.666655],[10.699524,-71.666307],[10.699712,-71.6661],[10.7001,-71.6661],[10.7001,-71.665726],[10.700405,-71.665457],[10.700655,-71.665278],[10.700758,-71.6652],[10.701,-71.6652],[10.701,-71.665016],[10.701143,-71.664891],[10.701285,-71.664746],[10.701457,-71.664567],[10.701746,-71.664319],[10.7019,-71.664469],[10.7019,-71.6652],[10.702652,-71.6652],[10.7028,-71.665329],[10.7028,-71.6661],[10.703686,-71.6661],[10.703931,-71.666313],[10.704301,-71.666649],[10.7046,-71.666921],[10.7046,-71.667],[10.704686,-71.667],[10.705411,-71.66766],[10.7055,-71.667741],[10.7055,-71.6679],[10.705676,-71.6679],[10.706167,-71.668344],[10.7064,-71.668559],[10.7064,-71.6688],[10.706662,-71.6688],[10.706678,-71.668815],[10.7073,-71.66937],[10.7073,-71.6697],[10.707661,-71.6697],[10.7082,-71.670189],[10.7082,-71.6706],[10.708653,-71.6706],[10.7091,-71.671005],[10.7091,-71.6715],[10.709646,-71.6715],[10.71,-71.671821],[10.71,-71.6724],[10.710623,-71.6724],[10.7109,-71.672674],[10.7109,-71.6733],[10.71154,-71.6733],[10.7118,-71.673539],[10.7118,-71.6742],[10.712556,-71.6742],[10.7127,-71.674316],[10.7127,-71.6751],[10.713571,-71.6751],[10.714017,-71.675507],[10.714508,-71.676022],[10.7154,-71.676797],[10.7154,-71.6814],[10.7145,-71.6814],[10.7145,-71.6823],[10.7154,-71.6823],[10.7154,-71.6832],[10.719,-71.6832],[10.719,-71.6841],[10.7208,-71.6841],[10.7208,-71.6859],[10.7217,-71.6859],[10.7217,-71.6877],[10.7235,-71.6877],[10.7235,-71.6868],[10.7244,-71.6868],[10.7244,-71.688711],[10.724212,-71.689984],[10.724015,-71.691289],[10.7244,-71.691277],[10.7244,-71.6913],[10.7262,-71.6913],[10.7262,-71.6922],[10.7253,-71.6922],[10.7253,-71.6931],[10.7235,-71.6931],[10.7235,-71.694],[10.7226,-71.694],[10.7226,-71.6931],[10.7199,-71.6931],[10.7199,-71.6922],[10.7181,-71.6922],[10.7181,-71.6913],[10.7172,-71.6913],[10.7172,-71.6922],[10.7163,-71.6922],[10.7163,-71.6913],[10.7136,-71.6913],[10.7136,-71.6922],[10.7127,-71.6922],[10.7127,-71.694],[10.7109,-71.694],[10.7109,-71.6949],[10.7091,-71.6949],[10.7091,-71.6958],[10.7073,-71.6958],[10.7073,-71.6967],[10.7064,-71.6967],[10.7064,-71.6976],[10.7046,-71.6976],[10.7046,-71.6985],[10.7028,-71.6985],[10.7028,-71.6994],[10.7019,-71.6994],[10.7019,-71.7003],[10.7028,-71.7003],[10.7028,-71.7012],[10.7037,-71.7012],[10.7037,-71.703],[10.7046,-71.703],[10.7046,-71.7048],[10.7055,-71.7048],[10.7055,-71.7066],[10.7064,-71.7066],[10.7064,-71.7075],[10.7055,-71.7075],[10.7055,-71.7084],[10.7064,-71.7084],[10.7064,-71.7093],[10.7055,-71.7093],[10.7055,-71.7111],[10.7046,-71.7111],[10.7046,-71.7129],[10.7055,-71.7129],[10.7055,-71.7165],[10.7046,-71.7165],[10.7046,-71.7174],[10.7055,-71.7174],[10.7055,-71.7192],[10.7073,-71.7192],[10.7073,-71.721],[10.7082,-71.721],[10.7082,-71.7219],[10.7073,-71.7219],[10.7073,-71.7237],[10.7064,-71.7237],[10.7064,-71.7246],[10.705841,-71.7246]],[[10.7253,-71.781035],[10.7244,-71.781019],[10.7244,-71.7804],[10.7226,-71.7804],[10.7226,-71.7786],[10.7217,-71.7786],[10.7217,-71.7777],[10.7226,-71.7777],[10.7226,-71.7759],[10.7244,-71.7759],[10.7244,-71.775],[10.7253,-71.775],[10.7253,-71.7759],[10.7271,-71.7759],[10.7271,-71.7777],[10.728,-71.7777],[10.728,-71.7786],[10.7271,-71.7786],[10.7271,-71.7804],[10.7253,-71.7804],[10.7253,-71.781035]],[[10.719023,-71.775],[10.719,-71.77495],[10.719,-71.7741],[10.718614,-71.7741],[10.7181,-71.772971],[10.7181,-71.7723],[10.717795,-71.7723],[10.7172,-71.770991],[10.7172,-71.7705],[10.7181,-71.7705],[10.7181,-71.7696],[10.719,-71.7696],[10.719,-71.7705],[10.7208,-71.7705],[10.7208,-71.7723],[10.7217,-71.7723],[10.7217,-71.7732],[10.7208,-71.7732],[10.7208,-71.775],[10.719023,-71.775]]]$z$::jsonb,
         zona_calculada_en = now(),
         zona_evidencia = $e${"posiciones":48719,"celdas_tocadas":840,"celdas_zona":1211,"celda_m":100,"cierre_m":300,"dias_max_en_una_celda":53,"celdas_de_un_solo_dia":87,"piezas_km2":[11.21,0.28,0.17],"descartado_km2":[0.15],"km2_zona":11.66,"km2_legal":71.5,"hasta":"2026-10-23"}$e$::jsonb
   where nombre = 'Parroquia Venancio Pulgar';

  select md5(string_agg(nombre || poligono::text || coalesce(poligono_oficial::text, ''),
                        '|' order by nombre))
    into despues from parroquias;

  -- 1. Quedo puesta, y SOLO en Venancio.
  select count(*) into k from parroquias where poligono_zona is not null;
  if k <> 1 then
    raise exception 'CONTROL: % parroquia(s) con zona; se esperaba 1 (solo Venancio)', k;
  end if;
  if not exists (select 1 from parroquias
                  where nombre = 'Parroquia Venancio Pulgar' and poligono_zona is not null) then
    raise exception 'CONTROL: la zona no quedo en Venancio';
  end if;

  -- 2. Es una LISTA DE ANILLOS, no un anillo suelto. Guardada plana, el mapa
  --    dibujaria una linea cruzando la ciudad y nadie entenderia por que.
  select jsonb_array_length(poligono_zona) into anillos
    from parroquias where nombre = 'Parroquia Venancio Pulgar';
  if anillos <> 3 then
    raise exception 'CONTROL: la zona tiene % anillo(s), se esperaban 3', anillos;
  end if;

  -- 3. ⛔ LA QUE DECIDE: la zona no puede meterse en terreno de otra parroquia.
  --
  --    ⚠️ Y SE MIDE EN METROS, NO CON «dentro o fuera». La primera version conto
  --    vertices con _punto_en_poligono y dio 81 afuera DESPUES de recortar, mas
  --    que antes: no era la zona, es que al recortar los vertices quedan ENCIMA
  --    de la linea y una prueba de rayo contesta cualquier cosa justo en el
  --    borde. Lo que importa no es de que lado cae un vertice apoyado en la
  --    raya, sino si la zona se METE en terreno ajeno.
  select count(*) into afuera
    from parroquias p,
         lateral jsonb_array_elements(p.poligono_zona) anillo,
         lateral jsonb_array_elements(anillo) v
   where p.nombre = 'Parroquia Venancio Pulgar'
     and not _punto_en_poligono((v->>0)::float8, (v->>1)::float8, p.poligono)
     and (select min(_dist_a_tramo_m((v->>0)::float8, (v->>1)::float8,
                                     (t.a->>0)::float8, (t.a->>1)::float8,
                                     (t.b->>0)::float8, (t.b->>1)::float8))
            from generate_series(0, jsonb_array_length(p.poligono) - 2) i,
                 lateral (select p.poligono->i a, p.poligono->(i+1) b) t) > 20;
  if afuera > 0 then
    raise exception 'CONTROL: % vertice(s) de la zona se meten mas de 20 m en terreno '
      'de otra parroquia', afuera;
  end if;

  -- 4. ⛔ NI UN LIMITE LEGAL SE TOCO, EN NINGUNA PARROQUIA.
  if antes <> despues then
    raise exception 'CONTROL: esta migracion le cambio el limite legal a alguna parroquia. '
      'Solo tenia que agregar la zona de trabajo de Venancio';
  end if;

  raise notice 'OK - Venancio: zona de trabajo de 11,66 km2 sobre un limite legal de 71,5. '
    'Los limites legales de las cuatro quedaron intactos.';
end $do$;
