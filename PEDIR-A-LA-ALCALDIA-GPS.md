# Que la Alcaldía vea nuestros camiones EN SU SOFTWARE — qué preguntar y qué dar

> ## ✅ YA ESTÁ CONTESTADO (21/10/2026, el mismo día)
>
> Leonel, el técnico de la Alcaldía, contestó a las tres preguntas que importaban. **Su
> plataforma es propia: IMAU Flota**, en la nube, y acepta la **vía (b)**: le mandamos cada
> posición por HTTP en **protocolo OsmAnd** (el de Traccar Client), con `id` = IMEI, `lat`,
> `lon`, `timestamp` en segundos Unix, `speed` **en nudos** y `bearing`. Mandó un ejemplo de
> llamada real, que era justo lo que había que exigirle. Un equipo aparece en su mapa **solo
> cuando ellos lo vinculan**.
>
> **Lo construido está en `migrations/gps_reenvio_alcaldia_2026-10-21.sql`,
> `supabase/functions/gps-reenvio/` y la alarma en `gps-vigilante?modo=reenvio`.**
> La dirección de su servidor **no está en este repo** (es público y ese endpoint no lleva
> clave): vive en `configuracion.gps_reenvio_url`.
>
> ⚠️ **Este archivo se queda como el registro de lo que se preguntó y por qué**, porque las
> preguntas son las que trajeron la respuesta. Las partes que hablan de «tres vías posibles»
> son **historia del 21/10 a la mañana**, no el estado de hoy.

> Escrito el **21/10/2026**. Todo lo que acá se afirma de nuestro lado está **medido contra la
> base ese día**, no estimado. Lo del proveedor vive en `PEDIR-AL-PROVEEDOR-GPS.md`.
> **Lo que se busca:** que nuestra señal entre a **su** plataforma de monitoreo y vean los
> camiones ahí, junto a los suyos. Que ellos miren nuestro mapa es el plan B, no esto.

---

## ✅ LO PRIMERO: SÍ SE PUEDE, Y EL RETRASO NO ES PROBLEMA

El miedo razonable con un reenvío es que la señal llegue tarde y en su pantalla el camión
aparezca donde ya no está. **Medido el 21/10 sobre las últimas 24 horas (5.909 posiciones, 10
unidades):** cuando una posición entra a nuestra base tiene

| antigüedad del dato al guardarlo | |
|---|---|
| típica (mediana) | **17 segundos** |
| 9 de cada 10 por debajo de | **51 segundos** |
| peor caso del día | 68 min — **y ese hueco es del equipo del proveedor, no del reenvío** |

**Reenviar agrega segundos, no minutos.** El retraso grande, cuando lo hay, ya viene del
aparato: ocurre igual si ellos reciben directo del proveedor.

Lo que sí hay que decirles es la **resolución**. ⚠️ Acá había un número mal, corregido el mismo
día: se escribió «1 posición cada 2,4 minutos», que es el promedio de las 24 horas y **mete las
horas estacionado**, cuando el equipo reporta 1 vez por hora. **Con el motor encendido llega 1
posición por minuto** (mediana sobre 11.874 intervalos). Son ~590 al día por unidad, casi todas
concentradas en la jornada. No hay resolución que ganar sondeando más rápido: ya tomamos todo lo
que el aparato manda.

---

## ⛔ EL DETALLE QUE CAMBIA TODO: «POR API» SON DOS COSAS DISTINTAS

Una plataforma de monitoreo **casi nunca sabe consumir un API ajeno**. Lo que estas plataformas
saben recibir es una de estas tres, y hay que averiguar **cuál de las tres** tiene la de ellos:

1. **Un aparato que les habla.** Todo rastreo funciona así: el equipo se conecta a un
   **IP y puerto** del servidor y habla un **protocolo** (el del fabricante). Nosotros podemos
   hacer exactamente eso **desde el servidor, sin tocar los camiones**: mandarles nuestras
   posiciones como si fuéramos diez equipos más. Es la vía más compatible que existe.
2. **Una dirección propia donde meterle posiciones** (un API de ingesta de ellos). Varias
   plataformas la tienen. Si existe, es la más simple: se le pega cada posición y listo.
3. **Una retransmisión desde otra plataforma.** Es el mecanismo estándar de la industria para
   pasar flotas entre operadores. Puede pedírsela **a Foresight directamente** y entonces
   nosotros no reenviamos nada: el dato va de su plataforma a la de ellos.

⛔ **No se escribe una línea hasta saber cuál de las tres.** Entre la 3 (un correo al proveedor)
y la 1 (una pieza nueva que habla un protocolo) hay semanas de diferencia. Y **el formato exacto
lo tiene que dar su documentación**: inventarlo es mandar datos que su sistema descarta en
silencio.

---

## LAS PREGUNTAS, EN ORDEN (para copiar y mandar)

Van dirigidas a **quien administra la plataforma**, que casi nunca es el funcionario que lo pide:
suele ser el proveedor de GPS de ellos. **Pedir ese contacto es parte de la pregunta 1.**

1. **¿Qué plataforma de monitoreo usan, qué versión, y por qué dirección web entran? ¿Quién la
   administra y con quién hablamos del lado técnico?**
2. **¿Cómo admite su plataforma unidades que no son de ustedes?** Nos sirve cualquiera de las
   tres: **(a)** registrar equipos que se conectan a un IP y puerto de ustedes, **(b)** un API de
   ustedes donde nosotros enviamos cada posición, **(c)** recibir una retransmisión de la
   plataforma de nuestro proveedor.
3. **Si es (a):** ¿a qué **IP pública y puerto** se conecta, **qué protocolo** acepta (y qué
   versión), y **cómo se registra** cada unidad del lado de ustedes?
4. **Si es (b):** ¿cuál es la **dirección exacta**, **cómo se autentica** (token, usuario y
   clave, firma), **cada cuánto** admite que se envíe, y **cuál es el formato de una posición**?
   **Pedir la documentación o un ejemplo de una llamada que les funcione** — no una descripción.
5. **Si es (c):** ¿a qué destino tiene que retransmitir nuestro proveedor y con qué protocolo?
   Eso se lo pedimos nosotros a Foresight por escrito.
6. **¿Con qué identificador quieren cada camión en su pantalla?** El nuestro es `JAC-B001` …
   `JAC-B012`; la placa también sirve. **Si su sistema exige un número de equipo (IMEI) por
   unidad, decirlo**: define si usamos el real o uno acordado.
7. **¿Qué necesitan ver: dónde está ahora, el recorrido del día, o las paradas de recolección?**
   Cambia qué se manda y cuánto.
8. **¿Las 10 unidades cuestan algo en su plataforma, y quién lo paga?** Casi todas cobran por
   unidad al mes. Esta pregunta puede cerrar el tema sola, así que va temprano.
9. **¿Hay un documento que firmar** (convenio, anexo del contrato)? Es dato de nuestra operación
   entrando a un sistema del Estado.

---

## QUÉ LE DAMOS NOSOTROS

**Nada secreto, y nada que no se pueda apagar.**

| Si la vía es | Le damos |
|---|---|
| **(a) equipos que se conectan** | La lista de las 10 unidades con su identificador acordado. El tráfico sale de nuestro servidor. |
| **(b) su API de ingesta** | Nada: **ellos** nos dan la dirección y la credencial. Las posiciones las enviamos nosotros. |
| **(c) retransmisión** | Una autorización por escrito a Foresight. Nada técnico. |
| **Plan B (ven nuestro mapa)** | Un usuario de solo-mirar. ⛔ Falta construirlo, ver abajo. |

⛔ **Nuestras credenciales de Foresight no se entregan en ninguna de las cuatro.** Son de un
usuario **compartido** que el manual del proveedor trae reciclado de otros clientes; ese API es
**HTTP sin cifrado** y la clave viaja a la vista en cada consulta (entregarla es publicarla); y
da acceso **a la cuenta**, no a una pantalla, así que no se puede limitar a mirar. Si lo que
quieren es entrar a la plataforma del proveedor, **que Foresight les cree su propio acceso de
solo lectura.**

📌 **Preferimos que la credencial la tengan ellos y no nosotros.** Si nosotros enviamos con una
llave suya (vía b), el día que se quiera cortar, se corta de los dos lados y sin discusión. Si
en cambio ellos leyeran de un API nuestro, la llave la administramos nosotros — también sirve,
pero pocas plataformas de monitoreo saben leer de afuera. Por eso se pregunta y no se asume.

---

## LO QUE TIENEN QUE SABER ANTES DE NOTARLO SOLOS

Va dicho de frente en la primera conversación. Descubierto en su pantalla, parece que escondemos.

- 🔴 **Van a ver 10 camiones, no 12.** `JAC-B011` y `JAC-B012` **no están en la cuenta del
  proveedor** (medido una por una el 29/08; hoy siguen apagados a propósito). Tienen el equipo
  instalado; falta que Foresight los habilite. **Lo que no está en la cuenta no se puede
  reenviar**: no es algo que podamos resolver de nuestro lado.
- **El punto no siempre es de ahora.** Lo típico es menos de un minuto, pero hay huecos reales
  de **22 y hasta 57 minutos con el camión andando**. Es el equipo del proveedor. Su pantalla
  tiene que mostrar **la antigüedad del dato**; si no, un camión parado en el mapa puede estar
  rodando. Preguntar si su plataforma la muestra.
- **Nuestro historial empieza el 14/08/2026** (hoy **261.408** posiciones, la última entró hace
  un minuto). ⛔ Antes de esa fecha **no existe y no se recupera**: el API del proveedor solo
  devuelve la posición actual, no tiene historial. Si piden el recorrido de un día de julio, la
  respuesta honesta es que no hay.
- **Los kilómetros del día los damos por el odómetro del equipo**, no sumando puntos: sumar
  puntos pierde ~17% y haría ver a todos los choferes inflando el kilometraje.

---

## QUÉ FALTA DE NUESTRO LADO

- **Vía (c):** nada. Es un correo a Foresight.
- **Vía (a) o (b):** una pieza nueva que lea `gps_posiciones` y reenvíe, **con su propio registro
  de qué se envió y qué no** — sin eso, un reenvío caído se ve igual que todo en orden. Es del
  tamaño del conector que ya tenemos. **No se puede escribir sin la respuesta de la 3 o la 4.**
- ✅ **El IMEI YA LO TENÍAMOS, y esta línea estaba equivocada.** Decía que había que
  recuperarlo del proveedor. Falso: `gps-sondeo` venía guardando el IMEI del aparato en
  `gps_posiciones.id_equipo` **desde agosto**. Los 10, de 15 dígitos, uno por unidad. Ahora
  están declarados en `gps_equipos.imei`, que es de donde los lee el reenvío.
  ⛔ Es el recordatorio de siempre: **un pendiente viejo se verifica contra el producto antes
  de repetirlo**, porque repetirlo manda a pedir afuera algo que ya estaba adentro.
- ⚠️ **La placa de `JAC-B008` está escrita distinta de los dos lados** (nuestra `A04EO1P`, la del
  proveedor `AO4E01P`). El identificador que se acuerde con la Alcaldía hay que fijarlo por
  escrito, o ese camión queda cambiado sin que nadie se entere.
- 🔴 **Plan B, si todo lo anterior se cae:** la pantalla ya existe (`mapa.html`, lee de nuestra
  base y se actualiza sola), **pero no hay un rol de solo-mapa**: el rol que hoy sirve para mirar
  (`visualizador`) abre también **banco, financiero, rentabilidad y deudas**. Darle ese usuario a
  la Alcaldía es darle las finanzas de Betangar. Hace falta un rol nuevo que vea el mapa y nada
  más.
