-- FlotaMax - Entregas/Evidencias: registrar COMO se confirmo (auditoria anti-fraude).
--   'sitio' = confirmado en el telefono del chofer (prueba debil)
--   'link'  = confirmado por el receptor desde SU telefono (prueba fuerte)
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).

alter table entregas add column if not exists confirm_via text;
