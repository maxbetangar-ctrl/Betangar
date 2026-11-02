// ═══════════════════════════════════════════════════════════════════════════════
// LA VENTANA DE HORA — en un módulo aparte para poder PROBARLA
//
// 🔴 POR QUÉ EXISTE (02/11/2026). La norma de la casa es no escribirle a nadie
//    fuera de 8:00-20:00 de Venezuela, y la cumplían SEIS funciones emisoras,
//    cada una por su cuenta (`auditar-combustible`, `choferes-dia`, `cumpleanos`,
//    `enviar-personal`, `km-sin-viaje`, `viajes-semanal`). El worker de la cola
//    —por el que pasan TODOS los mensajes— no la miraba. Medido en
//    `cola_mensajes`: el 28/10 salió un `soporte-programado` a las **23:52** a
//    Alejandra, que vive acá, y un `cierre-checklist` a las **22:00** a un
//    chofer. Y era justo lo que Virginia reportó el 21/10: «los recordatorios
//    están llegando muy tarde». Un emisor que nace sin la regla la rompe.
//    [[norma-arreglar-el-mecanismo-no-el-caso]]
//
// ⛔ Y VIVE ACÁ Y NO EN `index.ts` porque importar el index ARRANCA el `serve()`
//    del worker y el runner de pruebas se cae. Es el mismo motivo por el que
//    `wa-autoreply` tiene su `puerta-datos.ts` aparte: lo que se prueba no puede
//    estar pegado a lo que levanta un servidor.
// ═══════════════════════════════════════════════════════════════════════════════

export type Ventana = { desde: number; hasta: number };

/** La ventana por omisión: 8:00 a 20:00 hora de Venezuela. */
export const VENTANA_POR_DEFECTO: Ventana = { desde: 8, hasta: 20 };

/**
 * ⛔ A MÁXIMO SE LE ESCRIBE A CUALQUIER HORA, y es deliberado: las alarmas de la
 *    casa —una base caída, el respaldo que no corrió, el GPS atrasado— son de
 *    madrugada o no sirven de nada. Si la clave de configuración falta, la lista
 *    cae a estos dos números y NO a «no restringir nada»: así, falte lo que
 *    falte, las alarmas salen y un tercero no recibe un mensaje a medianoche.
 */
export const SIN_LIMITE_POR_DEFECTO = ['584147379886', '573017509763'];

/**
 * La hora de Venezuela de un instante dado, 0 a 23.
 *
 * ⚠️ `hour12: false` con 'en-US' devuelve **00** a medianoche en este runtime
 *    (medido: 2026-11-02T04:00:00Z → «00»), no «24» como en algunas versiones de
 *    ICU. Las dos formas caen igual fuera de 8-20, así que la ventana no cambia
 *    — pero queda escrito para que nadie use este número para otra cosa sin
 *    volver a medirlo.
 */
export function horaVE(cuando: Date): number {
  return Number(cuando.toLocaleString('en-US', {
    timeZone: 'America/Caracas', hour: '2-digit', hour12: false,
  }));
}

/** Si en ese instante se le puede escribir a un tercero. */
export function enHorarioVE(cuando: Date, ventana: Ventana = VENTANA_POR_DEFECTO): boolean {
  const h = horaVE(cuando);
  return h >= ventana.desde && h < ventana.hasta;
}

/**
 * Lee la ventana y la lista sin límite de lo que venga en `configuracion`.
 * ⛔ Un valor que no sirve se IGNORA y se avisa: el modo seguro de este
 *    interruptor es seguir respetando 8-20, no abrirlo.
 */
export function leerVentana(valor: unknown, avisar: (s: string) => void = console.log): {
  ventana: Ventana; sinLimite: string[];
} {
  let ventana = { ...VENTANA_POR_DEFECTO };
  let sinLimite = [...SIN_LIMITE_POR_DEFECTO];
  if (valor == null || valor === '') return { ventana, sinLimite };
  try {
    const c: any = typeof valor === 'string' ? JSON.parse(valor) : valor;
    if (Number.isInteger(c?.desde) && Number.isInteger(c?.hasta) &&
        c.desde >= 0 && c.hasta <= 24 && c.desde < c.hasta) {
      ventana = { desde: c.desde, hasta: c.hasta };
    } else if (c?.desde !== undefined || c?.hasta !== undefined) {
      avisar(`ventana_hora trae una ventana que no sirve (${JSON.stringify({ desde: c?.desde, hasta: c?.hasta })}): se usa ${ventana.desde}-${ventana.hasta}`);
    }
    if (Array.isArray(c?.sin_limite)) {
      const limpios = c.sin_limite.map((n: any) => String(n).replace(/\D/g, '')).filter(Boolean);
      // ⛔ Una lista VACÍA no se acepta: dejaría a la casa sin poder avisarse de
      //    noche, que es cuando más hace falta.
      if (limpios.length) sinLimite = limpios;
      else avisar('ventana_hora trae `sin_limite` vacia: se usan los numeros de la casa');
    }
  } catch (_e) {
    avisar('ventana_hora no es un JSON valido: se usan la ventana y la lista por defecto');
  }
  return { ventana, sinLimite };
}

/**
 * El CORTE de caducidad contando SOLO las horas en que el mensaje se pudo enviar.
 *
 * 🔴 POR QUÉ EXISTE (02/11/2026, antes de desplegar la ventana). El worker
 *    descarta a las 12 h lo que sigue `pendiente` —«un aviso operativo es de su
 *    día»— y ese barrido corre ANTES de la ventana. Juntas, las dos reglas se
 *    comen mensajes: lo encolado a las 20:01 se retiene hasta las 8:00 y llega
 *    con 12 h 04 → **descartado sin haber tenido un solo minuto para salir**.
 *    Y la ventana se mueve desde el teléfono: puesta en 8-18, TODO lo encolado
 *    de noche muere, en silencio. Mi propia retención le contaba como abandono.
 *    [[norma-la-caducidad-solo-cubre-el-tramo-propio]]
 *
 * ⛔ LA REGLA: la edad se mide en HORAS ENTREGABLES. Las horas en que la casa
 *    tenía la puerta cerrada no cuentan. Así el aviso sigue siendo «de su día»
 *    —se tira si tuvo 12 h de horario y nadie lo mandó— pero no se castiga al
 *    mensaje por una espera que le impusimos nosotros.
 *
 * ⚠️ Devuelve un INSTANTE, no un filtro por fila, y eso es a propósito: el
 *    barrido es un `UPDATE ... WHERE created_at < corte` de PostgREST, que no
 *    sabe llamar a una función. Vale porque la edad entregable CRECE con la
 *    antigüedad: si una fila pasa el corte, toda fila más vieja también.
 *
 * ⚠️ Camina de minuto en minuto en vez de calcular los tramos. Son ~1.440
 *    vueltas con la ventana de 12 h —nada, y corre una vez por invocación— y
 *    así no hay aritmética de husos que revisar: pregunta por cada minuto si
 *    era entregable, que es literalmente la regla. Lo claro le gana a lo listo.
 */
export function corteDeCaducidad(
  ahora: Date, ventana: Ventana = VENTANA_POR_DEFECTO, horas = 12,
): Date {
  let t = ahora.getTime();
  let faltan = Math.round(horas * 60);
  // Tope de seguridad: 30 días. Con `leerVentana` la ventana nunca es vacía
  // (exige desde < hasta), pero esta función es pública y nadie debe poder
  // colgar el worker pasándole una ventana imposible.
  const TOPE = 30 * 24 * 60;
  for (let pasos = 0; faltan > 0 && pasos < TOPE; pasos++) {
    t -= 60_000;
    if (enHorarioVE(new Date(t), ventana)) faltan--;
  }
  return new Date(t);
}
