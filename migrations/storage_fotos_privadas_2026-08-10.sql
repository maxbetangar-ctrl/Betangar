-- ═══════════════════════════════════════════════════════════════════════════
-- LAS FOTOS DEJAN DE SER PÚBLICAS  (Principal — hrkjddehqnzcqwlkklqm)
-- ═══════════════════════════════════════════════════════════════════════════
-- Comprobado el 10/08/2026, sin ninguna llave ni sesión:
--
--   listar  bucket 'asistencia'  → carpetas: asistencia, empleados, …
--   entrar  en una carpeta       → 5 archivos
--   DESCARGAR una selfie         → HTTP 200 · image/jpeg · 64.129 bytes
--
-- 623 selfies de fichaje del personal, 73 fotos de entrega y 14 de insumos, al
-- alcance de cualquiera con la URL. Las TABLAS estaban bien (se probaron 397 con
-- datos de personas y ninguna se dejó leer): el agujero era el storage, que es
-- justo lo único que la auditoría diaria NO mira.
--
-- Son DOS agujeros distintos y hay que cerrar los dos:
--   1) la política `SELECT` a `anon` → permite LISTAR y así descubrir las rutas
--   2) el bucket marcado `public` → permite DESCARGAR por URL directa, saltándose
--      el RLS por completo (la ruta /object/public/ no lo consulta)
--
-- Esta migración cierra el (1), que no rompe NADA: se comprobó que ni `fichar.html`
-- ni `chofer.html` LEEN del storage — solo suben, y `getPublicUrl` arma la cadena
-- en el navegador sin consultar al servidor. El (2) va junto con el cambio de
-- `app.js` a enlaces firmados, para no dejar al personal sin ver las fotos.

begin;

-- ── 1) `anon` deja de poder LISTAR las selfies de fichaje ───────────────────
-- El quiosco de fichaje solo SUBE (`asis_anon_ins` se queda). Leer no lo necesita.
drop policy if exists asis_anon_read on storage.objects;

-- ── 2) las fotos de entrega, solo para el personal ─────────────────────────
-- El chofer sube (INSERT/UPDATE se quedan); ver las fotos es cosa de la oficina.
drop policy if exists entregas_foto_select on storage.objects;
create policy entregas_foto_select on storage.objects
  for select to authenticated
  using (bucket_id = 'entregas');

-- ⛔ `edu_4c_select_anon_upload_reciente` NO se toca: es un permiso ACOTADO en
-- tiempo, puesto a propósito para que quien acaba de subir un documento de
-- inscripción pueda verlo un rato. Esos dos buckets además ya son privados.

-- ── 3) comprobar ───────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_policy
   where polrelid = 'storage.objects'::regclass
     and polcmd = 'r'
     and 'anon' = any(polroles::regrole[]::text[])
     and coalesce(pg_get_expr(polqual, polrelid), '') ~ '(asistencia|entregas)';
  if n > 0 then
    raise exception 'Quedan % políticas de lectura anónima sobre las fotos', n;
  end if;
  raise notice 'OK: anon ya no puede listar asistencia ni entregas.';
end $$;

commit;
