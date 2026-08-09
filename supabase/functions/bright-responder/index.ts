// ══════════════════════════════════════════════════════════════════════════════
//  bright-responder — PLANTILLA DE SUPABASE SIN PERSONALIZAR (revisado 2026-08-09)
//
//  Estaba desplegada en el proyecto y no tenía código en ningún repositorio, así
//  que se intentó rescatarla. Lo que se encontró:
//    · pesa 7,9 MB y es BYTE POR BYTE IDÉNTICA a la otra: «bright-responder» y
//      «Recordatorios» son el mismo archivo
//    · «bright-responder» es un nombre que genera Supabase solo
//    · sin tocar desde el 2026-05-23, versión 2
//    · NADIE la llama: ni un cron, ni app.js
//
//  ⚠️ CUIDADO CON UN FALSO POSITIVO QUE TUVE: buscar «Recordatorios» en los crons
//  da un resultado, pero es  —otra función, minúscula y con
//  guion, que SÍ está en el repo y SÍ se usa—. Verificado mirando la URL exacta:
//  el cron llama a /functions/v1/recordatorios-cron, no a /Recordatorios.
//
//  ⇒ Es la plantilla de ejemplo que crea Supabase al probar Edge Functions.
//     No hay código de Betangar acá.
//
//  El binario original está en OneDriveMAXWARE-respaldos-edge por si algún día
//  resulta que sí hacía algo. No va al repo: meter 16 MB de binario para
//  respaldar una plantilla de ejemplo es peor que el problema que resuelve.
//
//  ⏳ PENDIENTE: si se confirma, BORRARLA del proyecto. Una función viva que
//     nadie llama es superficie de ataque sin dueño.
// ══════════════════════════════════════════════════════════════════════════════
