-- Worker de la cola de correos: cada 5 minutos.
--
-- El comando NO se escribe a mano: se copia del worker de WhatsApp que ya lleva
-- meses andando, cambiándole solo el nombre de la función. Así hereda la misma
-- configuración probada (URL del proyecto y cabeceras) sin que nadie vuelva a
-- teclear una clave, que es donde se cuelan los errores.
select cron.schedule(
  'maxware-correos-worker',
  '*/5 * * * *',
  replace(command, 'procesar_cola_wassenger', 'procesar_cola_correos')
)
from cron.job
where jobname = 'betangar-wassenger-worker';
