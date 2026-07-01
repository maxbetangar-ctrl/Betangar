alter table empleados add column if not exists forma_pago text;
alter table empleados add column if not exists sueldo numeric default 0;
