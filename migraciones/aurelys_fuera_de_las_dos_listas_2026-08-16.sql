-- ⚠️ `configuracion.valor` es TEXT, no jsonb: no lleva cast al escribir, y sí al medirlo.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--  SACAR A AURELYS DE LA MENSAJERÍA — y de paso, las claves muertas       2026-08-16
--
--  QUÉ PASABA
--  AUREDY MEDINA (E002) dejó la empresa el 06/08/2026. Se la desactivó en `configuracion.whatsapp`
--  y **NO** en `configuracion.wa_empresarial`, donde seguía con `activo:true`.
--  Resultado medido hoy: **30 mensajes** salieron a su número desde la baja, todos `enviado`, el
--  último HOY 16/08 a las 18:00 de Caracas. 22 recordatorios, 1 fiscal, 2 de estado de cuenta.
--  (Los 3 del banco fueron el mismo 06/08, su último día: esos son defendibles.)
--
--  ⛔ LA LECCIÓN, QUE ES LA CARA
--  Dos listas para lo mismo. Apagarla en una se ve exactamente igual que apagarla en las dos —
--  desde la pantalla de configuración se la ve inactiva— y la que mandaba era la otra.
--
--  QUÉ SE HACE
--  1. `wa_empresarial`: se la quita del arreglo. Queda solo Gladys.
--     ⚠️ El rol `admin` queda SIN NADIE. Es correcto —no hay administradora— pero significa que
--        esos recordatorios no le llegan a nadie. Decidir a quién van, o aceptarlo a propósito.
--  2. `whatsapp`: se le vacía el número y queda la ranura inactiva.
--     ⛔ NO se borra el elemento: `app.js` restaura la config guardada POR ÍNDICE
--        (`waSaved.forEach(function(w,i){ if(WA[i]) ... })`, en tres lugares). Sacar un elemento
--        corre a todos los de abajo y le pegaría el número de una persona al rol de otra.
--        Se vacía la ranura, no se elimina.
--  3. Se vacían las 4 claves de CallMeBot que quedaban guardadas acá.
--     Máximo, 16/08: «callmebot ya no existe ni existirá más». Ya se sacaron del código servido;
--     esto cierra la copia de la base.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

update configuracion set valor = $j$[
  {"rol":"rrhh","num":"584246591474","desc":"RRHH — Gladys Jinet","activo":true}
]$j$
where clave = 'wa_empresarial';

update configuracion set valor = $j$[
  {"key":"","num":"584147379886","rol":"socios","desc":"Socio — Maximo Betancourt","activo":true},
  {"key":"","num":"584142411159","rol":"socios","desc":"Socio — Francisco Betancourt","activo":true},
  {"key":"","num":"","rol":"admin","desc":"(vacante — Auredy Medina, baja 06/08/2026)","activo":false},
  {"key":"","num":"584246591474","rol":"rrhh","desc":"RRHH — Gladys Jinet","activo":true},
  {"key":"","num":"584127634923","rol":"mecanica","desc":"Mecánico — Juan Carlos Davila","activo":true},
  {"key":"","num":"584146001635","rol":"operativo","desc":"Jefe de Operaciones — Samuel Mendoza","activo":true},
  {"key":"","num":"584246821254","rol":"contadora","desc":"Contadora — Ana Fuenmayor","activo":true}
]$j$
where clave = 'whatsapp';

-- ── COMPROBACIÓN — no se le cree al UPDATE ───────────────────────────────────────────────────
--  Se pregunta por su número en las DOS claves a la vez, y se pide además el total de entradas
--  como CONTROL: si el instrumento estuviera ciego, el conteo también daría cero.
select
  (select count(*)::int from configuracion
     where clave in ('whatsapp','wa_empresarial') and valor::text like '%4120276883%') as rastros_de_aurelys,
  (select jsonb_array_length(valor::jsonb) from configuracion where clave='whatsapp')         as entradas_whatsapp,
  (select jsonb_array_length(valor::jsonb) from configuracion where clave='wa_empresarial')   as entradas_empresarial,
  (select count(*)::int from configuracion
     where clave='whatsapp' and valor::text like '%"key":"7%')                          as claves_callmebot_que_quedan;
