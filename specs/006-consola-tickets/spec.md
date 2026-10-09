# Spec 006 — Consola de tickets (cada pedido es un ticket)

> Estado: **borrador (pendiente de OK de Juan)** · Responsable: Juan · Fecha: 2026-10-09

## Contexto para una IA
- Qué es esto en una frase: una página local donde cada pedido de Connecteam es un **ticket** con su conversación, la lectura de la foto, lo que piensa y hace el asistente (logs) y la respuesta, para que humano y asistente vean lo mismo; trabaja en paralelo con el widget del listener.
- Leer antes: `specs/constitution.md` (principios 1, 5, 6), specs 001 (logs), 002 (panel), 003 (visión), 005 (resiliencia, por escribir).
- Glosario: ticket = un pedido de un staff (un caso); espejo = copia de la conversación que el listener captura de Connecteam; puente = cola de órdenes de la consola hacia el listener.

## Problema y motivación
Hoy cada pedido vive en una tarjeta del widget (máximo 6, se pierden al recargar). Juan necesita ver todos los pedidos en orden de llegada, entender qué hace el asistente en cada uno y responder al staff citando su mensaje, sin depender de tarjetas que desaparecen.

## Requisitos funcionales
- **R-01** Cada pedido DEBE crear un ticket persistente en el servidor local (no en el navegador), identificado por el id del mensaje de Connecteam.
- **R-02** La consola DEBE mostrar a la izquierda los tickets **por orden de llegada**, con su estado (nuevo, esperando al staff, listo para aprobar, ejecutado, escalado, negado) y quién lo pidió.
- **R-03** Al centro DEBE mostrar la **conversación del ticket** (espejo): mensajes del staff con texto y fotos (con las cajas de la spec 003), y las respuestas propuestas o enviadas.
- **R-04** El ticket DEBE mostrar sus **logs** (spec 001): qué entendió, qué capturó, qué leyó, qué validó y qué decidió.
- **R-05** La consola DEBE permitir **responder por texto**. La respuesta se replica en Connecteam **citando el mensaje del staff correspondiente** (respuesta nativa "Reply") y siempre nombra a la persona (spec 002, R-17).
- **R-06** La respuesta se inserta en el cuadro de Connecteam y **una persona la envía** (constitución, principio 1). La consola nunca envía sola.
- **R-07** La consola DEBE poder aprobar o negar la ejecución (botón verde de la spec 002) con la misma evidencia que el widget.
- **R-08** El widget y la consola DEBEN compartir el mismo estado: lo que se hace en uno se ve en el otro.
- **R-09** Ningún pedido se pierde por una ráfaga (spec 005): todos aparecen como ticket aunque lleguen varios a la vez.
- **R-10** La consola DEBE ser una página aparte (`http://127.0.0.1:8787/tickets`), solo lectura y escritura locales, sin CORS y solo Host local, y NO se inyecta en el DOM de Connecteam.

## Fuera de alcance
- Incrustar la página real de Connecteam dentro de la consola (no verificado y probablemente bloqueado por el sitio). Se usa un **espejo** de la conversación.
- Enviar mensajes sin una persona.

## Criterios de aceptación
- **CA-01** Dados 5 mensajes que llegan juntos, entonces la consola muestra 5 tickets en orden de llegada (R-01, R-02, R-09).
- **CA-02** Al elegir un ticket se ve su conversación, su foto con hallazgos y sus logs (R-03, R-04).
- **CA-03** Al escribir una respuesta en la consola y pulsar "Insertar en Connecteam", el texto aparece en el cuadro de Connecteam como respuesta citando el mensaje del staff, con su nombre, y no se envía hasta que una persona lo haga (R-05, R-06).
- **CA-04** Aprobar en la consola o en el widget deja el mismo resultado en ambos (R-07, R-08).
- **CA-05** Recargar la página de Connecteam o reiniciar el navegador no borra ningún ticket (R-01).

## Riesgos y supuestos
- **K-01** El listener debe estar abierto en Connecteam para insertar respuestas (el puente depende de esa pestaña).
- **K-02** La foto del ticket se muestra desde su URL pública de Connecteam; no se guarda copia (privacidad, spec 003).
