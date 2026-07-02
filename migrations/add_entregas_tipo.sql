-- FlotaMax - Evidencias: mismo mecanismo de foto+GPS+sello sirve para ENTREGA o MANTENIMIENTO.
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).

alter table entregas add column if not exists tipo text;
