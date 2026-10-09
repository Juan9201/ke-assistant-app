# Spec 003 — Visión: leer la foto del ticket y mostrar qué ve el asistente

> Estado: aprobada por Juan (2026-10-08) · Responsable: Juan

## Contexto para una IA
- Qué es esto en una frase: el asistente lee las fotos que el staff comparte en el chat, identifica palabras clave (p. ej. `Receipt Number #19402005`) y **muestra gráficamente** en el panel qué reconoció y dónde, para que cualquier persona vea lo que "ve" el asistente.
- Leer antes: `specs/constitution.md` (principios 4, 5, 7), spec 002, `kb/docs/business-logic/playcard.md` (sección "Receipt ID en una foto").
- Glosario: hallazgo = texto reconocido con su posición en la imagen · palabra clave = patrón que el asistente busca · confianza = qué tan seguro está de la lectura.

## Problema y motivación
El staff manda un texto y una foto del ticket. El Receipt Number, el parque y la línea de flames suelen estar solo en la foto. Sin leerla, el asistente pregunta datos que ya fueron enviados. Además, Juan y cualquier otro usuario necesitan **ver** qué leyó el asistente para confiar en él.

## Usuarios y escenarios
| Actor | Situación | Resultado deseado |
|---|---|---|
| Staff | Envía texto + foto del ticket | No tiene que repetir lo que ya está en la foto |
| Juan / otro usuario | Mira el panel | Ve la foto con cada hallazgo enmarcado y etiquetado, y lo que no se encontró |
| Agente | Recibe el mensaje con imagen | Extrae los datos y los entrega a la spec 002 |

## Requisitos funcionales
- **R-01** El listener DEBE detectar las imágenes adjuntas de un mensaje del chat y obtenerlas con la mejor resolución disponible.
- **R-02** El texto y las fotos de un mismo pedido DEBEN tratarse como **un solo contexto** (misma persona, mensajes consecutivos cercanos en el tiempo).
- **R-03** El sistema DEBE leer el texto de la imagen con la posición de cada palabra.
- **R-04** El sistema DEBE buscar una **lista de palabras clave editable** (en la KB, no en el código) y extraer de la foto como mínimo: **Receipt Number** (`#` + dígitos), **Play Card**, **parque** (p. ej. `Kids Empire TX-Arlington`), **fecha/hora** y la línea de flames (`$20 = 102 flames x 1`).
- **R-05** El Receipt Number se acepta con **una sola lectura**; que aparezca repetido en el ticket no cambia su validez.
- **R-06** El panel DEBE mostrar la foto con **cajas y etiquetas** sobre cada hallazgo (por ejemplo "Receipt #19402005", "Parque: Arlington", "102 flames"), con su nivel de confianza.
- **R-07** El panel DEBE listar también lo que **no** se encontró, para que se vea qué falta.
- **R-08** El visor DEBE permitir ampliar la foto y resaltar un hallazgo al elegirlo en la lista.
- **R-09** Una lectura de baja confianza DEBE marcarse y NO alimenta el verde de la spec 002 sin que una persona la confirme o corrija en el panel.
- **R-10** Si la foto no se puede leer, el asistente DEBE proponer en inglés pedir una foto más clara.
- **R-11** Los datos extraídos de la foto DEBEN pasar por las mismas validaciones (V1, V2, etc.) que los del texto; la imagen nunca salta una guarda.
- **R-12** Cada lectura DEBE quedar en los logs (spec 001): qué se leyó, dónde y con qué confianza.
- **R-13** Los dígitos que acompañan a `Card Account: XXXX…` bajo `VISA/DISC Information` son del **método de pago** y DEBEN ignorarse. Solo el bloque `Card Type: Arcade` / `Purchase Date` / `Card Number: ******NNNN` aporta los últimos 4 dígitos de la **Play Card**.
- **R-14** Si el ticket imprime `@Arcade amount: N`, el visor DEBE mostrarlo como el total de flames de la línea.
- **R-15** Los ticket pueden pertenecer a cualquier parque; el parque se toma del encabezado del ticket (`Kids Empire XX-Ciudad`), que puede venir truncado por el OCR (p. ej. `N-North Bergen`), y se confirma contra el directorio de parques (spec 004).

- **R-16** Además del ticket de papel, DEBE leer **fotos de la pantalla de transacción de Gravity** (`Transaction #…`, tabla Description/Qty/Price, campos `PLAY_CARD` y `PUNCH_CARD`, "Paid (…)" y "NOTE:"). `Transaction #` es el Receipt Number.
- **R-17** El parque DEBE poder salir de cualquier pista de la foto (encabezado, "POS Device", correo del cajero tipo `ca-woodlandhills@kidsempire.us`); si las pistas apuntan a parques distintos, es un conflicto y no se elige.
- **R-18** En la pantalla de Gravity la cantidad (Qty) de la línea de flames va en otra columna: DEBE leerse de ahí; si no se puede, se marca para verificar en vez de suponerla.
- **R-19** Si el campo `PLAY_CARD` de la pantalla muestra la tarjeta (completa o con sus últimos 4), DEBE compararse con la del chat (V2). `PUNCH_CARD` no es una Play Card.
- **R-20** Un recibo completo (con totales) que no muestra ninguna línea de flames (Punchcard, membresía, solo entradas…) NO se descarta ni se escala: es una compra de flames con dos escenarios posibles y **Gravity decide**. Caso A: Gravity tiene los flames y falló la carga en Amusement (se resuelve). Caso B: el staff dio un recibo o una Play Card equivocados (se pide rectificar). La foto solo genera un aviso. *(Regla de Juan, 2026-10-09.)*

## Requisitos no funcionales
- **Seguridad y privacidad:** las fotos pueden traer datos del huésped. Se procesan en el PC de Juan y no se envían a terceros salvo decisión expresa; los logs guardan los hallazgos (texto, posición, confianza), no la imagen.
- **Costo:** preferir una lectura local de costo cero; un modelo de visión de pago solo se usa si la lectura local no basta y únicamente cuando hay imagen (constitución, principio 7).
- **Fiabilidad:** si la lectura falla o tarda demasiado, el panel lo indica y el flujo continúa por texto o pregunta al staff.
- **Rendimiento:** la lectura de una foto debe terminar en pocos segundos para que el panel no se sienta lento (objetivo medible en el plan).

## Fuera de alcance
- Reconocer objetos o personas (solo texto del ticket).
- Leer fotos que no sean de pedidos de flames.
- Elegir la librería (decisión del plan, tras probar con tickets reales).

## Criterios de aceptación
- **CA-01** Dado un mensaje con una foto de ticket, cuando llega, entonces el panel muestra la foto con cajas y etiquetas sobre Receipt Number, parque y línea de flames (R-03, R-04, R-06).
- **CA-02** Dado un ticket donde el Receipt Number aparece dos veces, entonces se toma como válido con una sola lectura (R-05).
- **CA-03** Dado un ticket sin Receipt Number visible, entonces el panel lo lista como "no encontrado" y se pregunta en inglés (R-07, R-10).
- **CA-04** Dada una lectura de baja confianza, entonces el campo queda marcado y el verde no se habilita hasta que una persona lo confirme (R-09).
- **CA-05** Dados un texto con la tarjeta y una foto con el recibo del mismo autor, entonces se procesan como un solo pedido (R-02).
- **CA-06** Dada una tarjeta leída de la foto distinta de la del recibo en Gravity, entonces se aplica R-V2 igual que con el texto (R-11).
- **CA-07** Al elegir un hallazgo en la lista, entonces se resalta su caja en la foto (R-08).
- **CA-08** Los logs de un caso con foto contienen los hallazgos y NO la imagen (R-12).
- **CA-09** Dado un ticket con `Card Account: XXXXXXXXXXXX7043` bajo `DISC Information`, esos 4 dígitos no se muestran como Play Card (R-13).
- **CA-10** Dado un ticket con `$20 = 102 flames x 4` y `@Arcade amount: 408`, el visor marca 408 como total de flames (R-14).
- **CA-11** Con los 5 tickets de `IMG Training`, el Receipt Number se lee correctamente en todos (prueba de aceptación de la librería elegida).

- **CA-12** Con las 4 fotos de pantalla de `IMG Training` (S01..S04), el Receipt Number se lee donde está visible, el parque sale en las 4 y la línea de flames de S01 se lee con su cantidad (R-16, R-17, R-18).
- **CA-13** Un recibo con Punchcard o de membresía, sin línea de flames, queda listo para validar en Gravity con un aviso (caso A o B); no se escala (R-20).
- **CA-14** Para evaluar la lectura: `npm run vision:eval` (campos contra `IMG Training/expected.json`) y `npm run vision:e2e` (foto + mensaje de ejemplo → qué haría el asistente, contra `scenarios.json`).

## Casos límite y escalaciones
| Caso | Comportamiento |
|---|---|
| Foto borrosa, girada o con reflejos | Marcar baja confianza; pedir foto más clara en inglés |
| Varias fotos en un pedido | Leer todas; mostrar los hallazgos de cada una |
| Foto que no es un ticket | Listar "sin hallazgos"; no inventar datos |
| Dos Receipt Numbers distintos en la foto | Pedir confirmar cuál es, sin elegir |
| Texto y foto se contradicen | Mostrar ambos y pedir aclaración |

## Riesgos y supuestos
- **K-01** Se asume que la imagen del DOM de Connecteam (`img.attachment-img`) es accesible desde el listener; la ruta `.../mobile/...` podría ser una versión reducida, y habrá que verificar en la página real si basta para leer el ticket.
- **K-02** "Mensajes consecutivos cercanos" se asume como la misma persona dentro de ~2 minutos (a confirmar con casos reales).
- **K-03** La lista de palabras clave inicial sale de `playcard.md`: `Receipt Number`, `Transaction #`, `Play Card`, parque y línea de flames.

## Checklist de revisión
- [x] Sin tecnología ni código en esta spec
- [x] Todo R-xx tiene al menos un CA-xx (R-01, R-12 se verifican en las pruebas del plan)
- [x] Cero `[NECESITA ACLARACIÓN]` pendientes
- [x] No contradice la constitución
