-- FlotaMax - Entregas/Evidencias: guardar la CALLE (dirección obtenida del GPS por reverse-geocoding).
-- Aditivo e idempotente. Correr en el SQL Editor de Supabase (proyecto hrkjddehqnzcqwlkklqm).

alter table entregas add column if not exists direccion_gps text;
