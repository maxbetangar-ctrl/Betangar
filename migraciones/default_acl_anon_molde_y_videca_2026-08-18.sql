-- ⛔ CAUSA RAÍZ: `pg_default_acl` daba EXECUTE sobre FUNCIONES a `anon` bajo el
--    grantor `postgres`. Eso significa que TODA función nueva que se cree en el
--    esquema `public` nace llamable con la llave pública, sin que nadie lo decida.
--    Es el hallazgo que la auditoría marca como «🔴 sanity causa raíz, DEBE volver
--    VACÍO» — y apareció justamente en las dos bases que NO se estaban auditando.
--
-- ⚠️ Esto NO toca las funciones que ya existen: solo corta la herencia. Lo de
--    antes se revoca aparte, una por una y a propósito.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
