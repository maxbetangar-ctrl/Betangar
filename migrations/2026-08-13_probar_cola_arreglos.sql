-- Prueba del candado de arreglos automáticos. Se prueba INTENTANDO PASARLO,
-- no leyendo el código: un candado que no se atacó no está probado.
-- Deja la base como la encontró (borra su función de prueba al final).

-- Conejillo de indias: security definer, sin search_path, ejecutable por anon.
create or replace function public.zz_prueba_arreglo() returns integer
  language sql security definer as $$ select 1 $$;
grant execute on function public.zz_prueba_arreglo() to anon;

delete from public.cola_arreglos where hallazgo_id like 'prueba/%';

insert into public.cola_arreglos (hallazgo_id, tipo, objeto, rol, privilegio, motivo, evidencia) values
  -- ── DEBEN APLICARSE ──────────────────────────────────────────────────────
  ('prueba/ok-search-path',  'fijar_search_path',  'public.zz_prueba_arreglo()', null, null,
   'security definer sin search_path', 'funcion de prueba creada por esta misma prueba, no la usa nadie'),
  ('prueba/ok-revoke-exec',  'revocar_ejecucion',  'public.zz_prueba_arreglo()', 'anon', null,
   'anon puede ejecutarla sin motivo', 'grep en los 14 repos: nadie la llama, nacio hoy en esta prueba'),

  -- ── DEBEN RECHAZARSE ─────────────────────────────────────────────────────
  ('prueba/no-rol-postgres', 'revocar_privilegio', 'public.cumples',      'postgres', 'SELECT',
   'intento de tocar un rol que no es publico', 'evidencia larga y suficiente para pasar ese filtro'),
  ('prueba/no-intocable-cfg','revocar_privilegio', 'public.configuracion','authenticated','SELECT',
   'intento contra la tabla de secretos', 'evidencia larga y suficiente para pasar ese filtro'),
  ('prueba/no-intocable-col','revocar_privilegio', 'public.cola_correos', 'anon', 'SELECT',
   'intento contra la cola de entrega', 'evidencia larga y suficiente para pasar ese filtro'),
  ('prueba/no-sin-evidencia','revocar_ejecucion',  'public.zz_prueba_arreglo()', 'anon', null,
   'sin evidencia', 'corto'),
  ('prueba/no-priv-raro',    'revocar_privilegio', 'public.cumples',      'anon', 'TRUNCATE',
   'privilegio fuera de la lista', 'evidencia larga y suficiente para pasar ese filtro'),
  ('prueba/no-existe',       'revocar_privilegio', 'public.no_existe_xyz','anon', 'SELECT',
   'tabla inexistente', 'evidencia larga y suficiente para pasar ese filtro'),
  -- Tiene que rechazarlo POR LAS FILAS, no por estar protegida ni por tener ya
  -- RLS: por eso se usa `auditoria`, que tiene ~27.800 filas y no es intocable.
  ('prueba/no-rls-con-filas','encender_rls',       'public.auditoria', null, null,
   'RLS sobre tabla con datos', 'evidencia larga y suficiente para pasar ese filtro'),
  ('prueba/no-fn-sin-firma', 'fijar_search_path',  'public.zz_prueba_arreglo',  null, null,
   'falta la firma con parentesis', 'evidencia larga y suficiente para pasar ese filtro');

select * from public.aplicar_arreglos_seguros(50);
