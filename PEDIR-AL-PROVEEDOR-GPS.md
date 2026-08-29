# Lo que hay que pedirle a Foresight GPS — en este orden

> Actualizado el **29/08/2026**, el día que ampliaron el acceso de 1 a **10 unidades**.
> Techo de flota acordado con Máximo: **60 unidades**.
> Todo lo de acá está **medido contra el API**, no es lo que dijeron por teléfono.
> Las preguntas 1 y 5 (de la versión del 15/08) **ya están contestadas y se cayeron**.

---

## 🔴 1. FALTAN DOS UNIDADES: JAC-B011 y JAC-B012

Es lo primero porque es lo único que hoy nos falta de ellos y no depende de que
cambien nada.

Medido el 29/08 preguntando **una por una**, con control positivo (las otras 10
contestan con datos en la misma corrida):

| unidad | placa | respuesta del API |
|---|---|---|
| JAC-B011 | `A15EN3P` | `responseCode 200` — conjunto vacío |
| JAC-B012 | `A07EV6P` | `responseCode 200` — conjunto vacío |

**No están en la cuenta.** Las dos tienen equipo GPS instalado (eso lo confirmaron
ellos el 14/08); lo que falta es el acceso.

---

## 🔴 2. LA PLACA DE JAC-B008 ESTÁ MAL ESCRITA EN SU SISTEMA

En nuestro registro la placa del camión es **`A04EO1P`**. Su API la nombra
**`AO4E01P`** — la letra O y el número 0 intercambiados. Medido: pidiendo la placa
real contesta conjunto vacío; con la suya contesta con datos.

Las otras once placas siguen todas el mismo patrón (letra + 2 dígitos + 2 letras +
1 dígito + P). La que rompe el patrón es la de ellos.

**Qué pedir:** que la corrijan de su lado. Mientras tanto nuestro conector la casa
por una columna aparte (`gps_equipos.placa_proveedor`), así que **no urge** — pero
el día que la arreglen sin avisar, esa unidad se calla. Conviene que quede por escrito
de los dos lados.

---

## ✅ 3. ¿UNA PETICIÓN PUEDE TRAER VARIAS PLACAS? — **CONTESTADO: SÍ**

**Era la pregunta que más plata y más producto decidía. Ya está resuelta, y sin que
ellos tuvieran que hacer nada.**

**Omitiendo el parámetro `plateno`, el API devuelve TODAS las unidades de la cuenta
en una sola llamada** (`responseCode 100`, 10 registros el 29/08). El conector ya
funciona así: la vuelta completa pasó de **54 segundos a 1**.

Con esto se cae el problema que teníamos escrito acá: a 1 petición por unidad y el
tope de 10 pet/min, una vuelta a 60 unidades tardaba **6 minutos**, el camión saltaba
cuadras enteras y **las paradas de recolección desaparecían** — que es justo lo que
se le muestra a la Alcaldía para probar que se detuvo a recoger y no solo pasó.

⚠️ Lo que **no** funciona es enumerar placas separadas por coma: sigue devolviendo
conjunto vacío. Y ahora sí está probado de verdad — se repitió con dos placas que
responden por separado, cosa que el 15/08 no se podía hacer con una sola placa en el
demo.

**Lo único que queda por preguntarles acá:** si el listado sin `plateno` tiene **tope
de registros**. Hoy devuelve 10 y tenemos 10, así que no se puede distinguir «todas»
de «las primeras 10». **Cuando habiliten B011 y B012, si el listado sigue devolviendo
10, hay tope** — y con 60 unidades eso vuelve a romper todo. Es la primera medición a
hacer el día que las habiliten.

---

## 🥈 4. ¿Cada cuánto reporta el equipo, y se puede bajar?

**Éste es el techo real de todo, y ahora es el pendiente más importante.** Por más
rápido que preguntemos, no puede haber más puntos que los que el aparato manda — y
desde que la petición única quitó el límite de nuestro lado, **el equipo es el único
cuello que queda**.

**Y ya no es un pedido teórico. Medido sobre 16 días de JAC-B010, con el camión
ANDANDO** (el odómetro subió durante el silencio, así que no es el camión apagado):

| día | el equipo se calló | km recorridos **a ciegas** |
|---|---|---|
| **19/08** · 12:49→13:46 | **57 min** | **22,77 km** |
| 15/08 · 19:17→20:06 | 49 min | 18,67 km |
| 17/08 · 16:19→16:46 | 27 min | 10,35 km |
| 21/08 · 11:33→12:39 | 66 min | 1,87 km |
| 18/08 · 11:11→12:12 | 61 min | 2,13 km |

**El 19 de agosto el camión recorrió 22,77 km en 57 minutos y no hay una sola
posición de ese rato.** Con eso alcanza para ir al botadero, descargar y volver sin
que quede rastro — que es exactamente el uso que este servicio tiene que soportar.

**Qué preguntar:** ¿en cuánto está configurado el intervalo de reporte? ¿Se puede
bajar a **15-30 segundos** con el motor encendido (y dejarlo largo con el motor
apagado, que ahí no interesa)? Y sobre todo: **¿por qué el equipo deja de reportar
más de una hora con el motor encendido?** Eso no es intervalo, es una caída.

---

## 🥉 5. ¿Pueden mandar ellos (push / webhook) en vez de que preguntemos?

Sigue siendo la mejor solución para el detalle: cada posición llega cuando el equipo
la genera, sin depender de nuestra frecuencia de sondeo.

**Qué preguntar:** ¿el sistema puede hacer POST a una URL nuestra cada vez que un
equipo reporta?

---

## 6. El historial de 90 días

Guardan 90 días y **hoy no se pueden bajar**: el método falla con
`Could not find stored procedure 'FSSP_API_<method>'`. Su API, como está, es un
**sondeador**, no un descargador.

⛔ Consecuencia que ya nos costó: entre el 14 y el 29 de agosto **solo existe el
recorrido de una unidad**, porque las otras nueve no estaban habilitadas y no hay de
dónde recuperarlas. El historial nace el día que arranca el sondeo.

**Qué preguntar:** ¿cuál es el método correcto para bajar el historial por rango de
fechas? Y en particular: **¿se puede recuperar el 14–29 de agosto de las 9 unidades
que acaban de habilitar?** Ellos lo tienen guardado; nosotros no.

---

## ✅ 7. El límite de 10 peticiones/minuto — **YA NO IMPORTA**

Con la petición única, toda la flota entra en **una** llamada por ciclo. Estamos a
1 petición por minuto contra un tope de 10. Deja de ser un tema.

---

## 8. Lo administrativo y lo que hay que decirles por escrito

- **Credenciales propias de Betangar.** Las que usamos siguen siendo las del demo
  (`terpel` / `BETA.2016`), y su manual venía con un ejemplo de otro cliente
  (`OCCICARGA` y una placa ajena): es un documento reciclado.
- **Acceso a las 60 unidades** cuando se llegue a ese número.
- ¿**Restringen por IP**? Nuestro conector corre en la nube, donde la IP cambia sola.
- ¿**Avisan** si un equipo deja de reportar? (Ver el punto 4: nosotros lo detectamos
  solos, pero deberían saberlo ellos primero.)
- ⚠️ Decirles que su API es **HTTP sin TLS** —la clave viaja en Base64, que no es
  cifrado, en cada llamada— y que **filtra nombres de procedimientos internos** en
  los mensajes de error (`FSSP_API_<method>`).

---

### Lo que NO hay que pedirles

- **Telemetría de combustible, temperatura y horómetro.** Llegan en cero porque **el
  sensor no está**, no porque no lo manden. Pedirlo es pedir un equipo distinto, no un
  cambio de API.
- **Subir el límite de peticiones para ganar precisión de kilometraje.** No la gana:
  el km del día sale del **odómetro** (final − inicial) y sondear el doble de rápido
  casi no lo mejora (−17,1 % vs −18,9 % sumando líneas). Se pide detalle por el
  **trazado** y las **paradas**, que es otra cosa.
