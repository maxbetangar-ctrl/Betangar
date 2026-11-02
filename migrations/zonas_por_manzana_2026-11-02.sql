-- ════════════════════════════════════════════════════════════════════════════
--  LAS ZONAS, HECHAS DE MANZANAS — Y SOLO DENTRO DE NUESTRAS PARROQUIAS.
--
--  Esta migración NO lleva los datos: los calculan dos herramientas, porque son
--  miles de coordenadas que no se escriben a mano y que hay que poder rehacer.
--      maxware-tools/zonas-solo-nuestras-parroquias.mjs   (qué calle es de quién)
--      maxware-tools/zonas-por-manzana.mjs                (el dibujo de la zona)
--  Acá queda el PORQUÉ, que es lo que no está en el código.
--  [[norma-dos-listas-a-mano-se-desincronizan]]
--
--  ── 1 · SE TRABAJA SOLO EN NUESTRAS PARROQUIAS ────────────────────────────
--  Máximo, 2/11/2026, mirando el mapa: «te marqué la división de las rutas que
--  hiciste y están por fuera de los límites de la propia parroquia, eso no tiene
--  sentido» · «recordá que de eso depende lo que va a recorrer cada camión».
--
--  Medido: **16,6 km de calle asignada caían fuera de su parroquia** — Santa
--  Lucía el 10,3% de su total, Olegario 3,7%. Y 13 tramos enteros estaban en la
--  parroquia equivocada.
--
--  ⛔ LA CAUSA NO ERA LA QUE PARECÍA, Y SE EQUIVOCÓ DOS VECES ANTES DE DAR CON
--     ELLA. No fue el recorte de costa del 23/10 (medido: CERO metros de los que
--     quedan afuera caen en la franja que ese recorte sacó) ni el filtro del área
--     de trabajo del GPS (ese ni se usaba en tres de las cuatro). Fue esto: el
--     sectorizador elige la calle por el PUNTO MEDIO y después corta las avenidas
--     grandes en tramos para repartir la carga — **y los pedazos heredan la
--     parroquia de la calle madre sin volver a comprobar**. La Avenida El Milagro
--     entra por Santa Lucía porque su medio está ahí, y un pedazo cae en Olegario.
--
--  Decisión de Máximo: «debe trabajarse solo en nuestras parroquias».
--      · 7,8 km que caían en parroquias ajenas (Bolívar, Borjas Romero, Juana de
--        Ávila, Idelfonso Vásquez) SALIERON del reparto. ⚠️ Los camiones las
--        trabajan — la Avenida 84 tenía 236 posiciones de recolección en 21 días
--        — así que es trabajo que se hacía y no estaba en ningún contrato.
--      · 9,1 km se mudaron a la parroquia correcta, a la zona más cercana CON
--        ACCESO comprobado (una calle de esa zona a ≤25 m). 19 de 21 pedazos
--        tuvieron acceso a 0 m. [[norma-no-es-la-distancia-es-el-acceso]]
--      · Resultado: 16,6 km → **110 m**, que es la resolución de 5 m con la que
--        se corta en el borde.
--  🔴 QUEDA ABIERTO: la Calle 60B (277 m) se mudaría de Venancio a Caracciolo
--     pero no tiene calle conectada a menos de 25 m. No se decidió sola.
--  ⚠️ Y mover una calle de parroquia LE CAMBIA EL DÍA de recolección: la Avenida
--     84 y la Calle 67 pasan de Venancio (miércoles y sábado) a Caracciolo
--     (viernes). Los vecinos lo van a notar.
--
--  ── 2 · EL LÍMITE CORRE POR LA CALLE, NO EN ZIGZAG ────────────────────────
--  Máximo, el mismo día: «¿por qué pones los límites en zigzag si puedes usar
--  calles como límites? no entiendo».
--
--  ⛔ TENÍA RAZÓN Y NO ERA UNA DECISIÓN. El territorio se pintaba con una rejilla
--     de casillas de 45 m y el borde escalonado ERA el borde de las casillas. No
--     había criterio detrás del zigzag: era el método asomándose en el producto.
--
--  Ahora una zona es un conjunto de MANZANAS, y las manzanas las delimitan las
--  calles — así que el límite corre por la calle POR CONSTRUCCIÓN y se puede
--  decir en voz alta: «tu zona llega hasta la Avenida 4». Las manzanas salen de
--  recorrer las CARAS del grafo del callejero; cada una se queda con la zona de
--  las calles que la rodean (pesando por metros); las vecinas de la misma zona
--  se fusionan tirando las aristas que comparten.
--
--  Resultado: **1.890 manzanas** · Santa Lucía 174, Caracciolo 293, Olegario 510,
--  Venancio 913. Entre 15 y 91 manzanas por zona, en 68 anillos para 34 zonas —
--  o sea que casi todas las zonas quedan de una o dos piezas.
--  ⚠️ Venancio deja **79 manzanas sin zona**: son las del norte rural, sin ninguna
--     calle asignada alrededor. Quedan fuera de toda zona, que es lo correcto.
--  ⚠️ Lo que el método NO puede resolver: si dos calles se cruzan sin esquina —un
--     elevado, un puente— el grafo las une igual y la manzana sale mal. Se vería
--     como una manzana enorme.
--
--  ── 3 · EL CANDADO, PARA QUE NO VUELVA ────────────────────────────────────
--  `sectorizar-parroquia.mjs` ahora exige además que la calle caiga dentro del
--  límite de la parroquia (`poligono_oficial`), no sólo que lo diga su columna.
--  ⚠️ Eso filtra calles ENTERAS; el corte en tramos sigue heredando la parroquia.
--     Mientras las avenidas se corten, hay que volver a comprobar cada pedazo —
--     está anotado en el archivo.
-- ════════════════════════════════════════════════════════════════════════════

comment on column zonas.anillos is $c$El contorno de la zona, [[[lat,lon],...],...]: el PRIMERO es el borde de afuera y los demás son huecos (regla par-impar). ⛔ Desde el 2/11/2026 NO sale de una rejilla: sale de las MANZANAS del callejero fusionadas, así que el límite corre por calles de verdad y no en zigzag — «tu zona llega hasta la Avenida 4» es literal, no una forma de hablar. Lo calcula maxware-tools/zonas-por-manzana.mjs; esta tabla NO se edita a mano.$c$;

comment on column zona_calles.parroquia is $c$De qué parroquia es ESTE TRAMO — no la calle madre. ⛔ Las avenidas grandes se cortan en tramos para repartir la carga, y hasta el 2/11/2026 los pedazos heredaban la parroquia de la calle entera sin comprobar: así 16,6 km quedaron asignados fuera de su parroquia (Santa Lucía, 10,3%). Si se vuelve a cortar una calle, hay que volver a decidir la parroquia de cada pedazo.$c$;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $v$
declare v_zonas int; v_sin int; v_calles int;
begin
  select count(*) into v_zonas from zonas where jsonb_array_length(anillos) > 0;
  if v_zonas < 30 then
    raise exception 'solo % zonas tienen contorno: el recalculo no llego a todas', v_zonas;
  end if;

  -- ⛔ Ninguna zona puede quedar sin calles: sería un camión sin trabajo.
  select count(*) into v_sin from zonas z
   where not exists (select 1 from zona_calles c
                      where c.parroquia = z.parroquia and c.zona = z.zona);
  if v_sin > 0 then
    raise exception '% zona(s) quedaron SIN NINGUNA CALLE', v_sin;
  end if;

  -- Y el total de calles repartidas tiene que seguir siendo del orden de 1.900:
  -- si bajó mucho, el recorte se comió trabajo real.
  select count(*) into v_calles from zona_calles;
  if v_calles < 1700 then
    raise exception 'quedan % tramos repartidos: se esperaba del orden de 1.900', v_calles;
  end if;

  raise notice 'OK · % zonas con contorno · % tramos repartidos', v_zonas, v_calles;
end $v$;
