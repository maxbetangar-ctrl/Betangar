# Lo que hay que pedirle a Foresight GPS — en este orden

> Escrito el **15/08/2026**. Techo de flota acordado con Máximo: **60 unidades**.
> ⏰ **El demo vence el 24/08** y hoy da acceso a **una sola placa** (`JAC-B010`).
> Todo lo de acá está **medido contra el API**, no es lo que dijeron por teléfono.

---

## 🥇 1. ¿UNA petición puede traer VARIAS placas?

**Es la pregunta que más plata y más producto decide, y hay que hacerla primero.**

Hoy el sondeo va **una petición por unidad**, y el proveedor topa en **10 peticiones por minuto**.
Con eso, una vuelta completa a la flota tarda:

| unidades | vuelta completa | qué se ve en el mapa |
|---|---|---|
| 1 (hoy, demo) | 6 s | fluido |
| 12 | 72 s | aceptable |
| **60** | **6 minutos** | **una foto cada 6 min: no sirve** |

A 6 minutos por vuelta, el camión salta cuadras enteras entre punto y punto y **las paradas de
recolección desaparecen casi todas** — para ver una parada hace falta que el equipo reporte dos
veces desde el mismo lugar. Y esas paradas son justo lo que se le muestra a la Alcaldía para
probar que el camión **se detuvo a recoger** y no solo pasó por la calle.

⛔ **OJO: que esto no se pueda ya está anotado en nuestro código, y la prueba que lo afirmaba NO
SERVÍA.** Dice «probado `plateno` con dos placas separadas por coma: devuelve conjunto vacío». Pero
el demo **solo da acceso a una placa**: pedir dos y recibir vacío es exactamente lo que el API
debe contestar cuando una no es tuya. Esa prueba no distingue «no acepta varias placas» de «no
tenés esa placa».

**Qué preguntar, textual:** ¿existe un método que devuelva el estado de **todas** las unidades de
la cuenta en una sola llamada, o `plateno` acepta una lista de placas? Si acepta lista, ¿cuántas
por llamada?

**Y cuando lleguen las 12 placas definitivas, lo PRIMERO es repetir la prueba** con dos que sí
tengan acceso, antes de creerle a nadie.

---

## 🥈 2. ¿Cada cuánto reporta el equipo, y se puede bajar?

**Éste es el techo real de todo.** Por más rápido que preguntemos, no puede haber más puntos que
los que el aparato manda.

**Medido el 14/08 sobre 31 reportes en 45 min:** mediana **1,02 min**, p90 **3,92 min**, máximo
**22,35 min**. O sea que reporta ~1 vez por minuto en el caso típico, con una cola larga fea.

**Qué preguntar:** ¿en cuánto está configurado el intervalo de reporte? ¿Se puede bajar a **15-30
segundos** con el motor encendido (y dejarlo largo con el motor apagado, que ahí no interesa)?

**Por qué importa:** con reportes cada minuto solo se detectan paradas de **2 minutos o más**. Las
paradas cortas de recolección **no existen en el dato**. Bajar el intervalo es lo único que las
hace aparecer — ninguna mejora de pantalla lo suple.

---

## 🥉 3. ¿Pueden mandar ellos (push / webhook) en vez de que preguntemos?

Mata los dos problemas anteriores de una vez: no hay límite de peticiones que alcanzar ni vuelta
que tarde. Cada posición llega cuando el equipo la genera.

**Qué preguntar:** ¿el sistema puede hacer POST a una URL nuestra cada vez que un equipo reporta?

---

## 4. El historial de 90 días

Guardan 90 días y **hoy no se pueden bajar**: el método falla con
`Could not find stored procedure 'FSSP_API_<method>'`. Su API, como está, es un **sondeador**, no
un descargador.

⛔ Consecuencia que ya nos cuesta: **el historial nace el día que arranca el sondeo**. Cada hora sin
sondear es un pedazo de recorrido que no va a existir nunca.

**Qué preguntar:** ¿cuál es el método correcto para bajar el historial por rango de fechas?

---

## 5. El límite de 10 peticiones/minuto

Va **último a propósito**: si contestan bien la 1, deja de importar.

**Qué preguntar:** ¿el límite es **por cuenta o por placa**? (nadie lo preguntó; está anotado a
secas). Y si es por cuenta, ¿a cuánto lo pueden subir?

⚠️ **No pedirlo para ganar precisión de kilometraje**: no la gana. El km del día sale del
**odómetro** (final − inicial), y sondear el doble de rápido casi no lo mejora (−17,1 % vs −18,9 %
sumando líneas). Se pide por el **trazado** y por las **paradas**, que es otra cosa.

---

## 6. Lo administrativo y lo que hay que decirles por escrito

- **Acceso a las 60 unidades** y credenciales propias de Betangar (hoy: demo de 1 placa que vence
  el **24/08**).
- ¿**Restringen por IP**? Nuestro conector corre en la nube, donde la IP cambia sola.
- ¿**Avisan** si un equipo deja de reportar?
- ⚠️ Decirles que su API es **HTTP sin TLS** y que **filtra nombres de procedimientos internos** en
  los mensajes de error.

---

### Lo que NO hay que pedirles

- **Telemetría de combustible, temperatura y horómetro.** Llegan en cero porque **el sensor no
  está**, no porque no lo manden. Pedirlo es pedir un equipo distinto, no un cambio de API.
