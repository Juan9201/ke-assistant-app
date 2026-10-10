# 008 · Respuestas automáticas: pedido de reembolso — Aprobada

> Estado: **aprobada por Juan (2026-10-10, reglas dictadas en chat)** · Responsable: Juan

## Contexto para una IA
- Primer caso de "más respuestas automáticas" por mensaje (después de flames). Cada una es una regla determinista (sin IA) que propone una respuesta; **una persona la revisa y envía** (principio 1).
- Leer antes: `specs/constitution.md` (R2: reembolsos siempre escalan), spec 006 (tickets).
- Convive con la regla vieja de flames ("reembolso + tarjeta/flames → escalar"): la nueva regla manda cuando el mensaje es un **pedido de reembolso** (R-01); lo demás sobre reembolsos sigue escalando.

## Reglas dictadas por Juan
1. El staff pide un reembolso ("needs a refund", "we need a refund processed", "can we get a refund?", "I am requesting a refund") → responder **siempre con el nombre**: `[nombre], did you submitted the refund request, correct?`
2. Si responde que sí ("yes", "Yes did", cualquier afirmación) → `Thank you so much! We will review it.`
3. Si responde que no → `Understood, feel free to do so!! Thank you.`

## Requisitos
- **R-01** Un mensaje que **pide** un reembolso (necesitar/querer/pedir/procesar/conseguir un "refund") DEBE crear un ticket de protocolo `refund` con la pregunta de la regla 1, con el nombre sin rango (spec 007). Mensajes que solo mencionan un reembolso ya hecho ("was refunded", "refund request submitted") o lo niegan ("don't need a refund") NO la activan.
- **R-02** La respuesta del **mismo staff** dentro de 45 min (spec 006, R-02) DEBE leerse como respuesta a esa pregunta: afirmativa → regla 2; negativa → regla 3. Las respuestas siguientes no repiten el saludo ni el nombre.
- **R-03** Una respuesta corta que no es ni sí ni no, o con ambos ("no, yes"), NO genera respuesta: el ticket se escala a Juan. Un mensaje largo o con pregunta ("what form?") no se toma como respuesta y sigue su flujo normal.
- **R-04** Estados: pregunta hecha → `waiting_staff`; "sí" → `escalated` (Juan revisa el reembolso); "no" → `resolved`; respuesta no clara → `escalated`.
- **R-05** El asistente NUNCA ejecuta ni promete un reembolso: solo pregunta y avisa "We will review it" (R2 intacto; la revisión y la decisión son de una persona).
- **R-06** La respuesta se **inserta** (nunca se envía sola) como en flames; los textos van en una sola línea (insertar saltos de línea en el cuadro de Connecteam puede enviar el mensaje).
- **R-07** Todo queda en `/logs` y el ticket aparece en la consola `/tickets` con el protocolo "Reembolso".

## Criterios de aceptación
- **CA-01** "AM Rashel Carswell: we need a refund processed" → ticket #N `waiting_staff` y respuesta `Rashel, did you submitted the refund request, correct?`
- **CA-02** Las cuatro frases de Juan activan la regla; "the guest was refunded" y "no need for a refund" no.
- **CA-03** Después: "Yes did" → `Thank you so much! We will review it.` y ticket `escalated`; "No" → `Understood, feel free to do so!! Thank you.` y ticket `resolved`; "maybe" → escalado sin respuesta.
- **CA-04** Un mensaje de flames del mismo autor tras una pregunta de reembolso no se mezcla con ese ticket.

## Supuestos (a confirmar con Juan)
- Se respeta la redacción literal de Juan ("did you submitted"). Si prefieres "did you submit", se cambia en un solo lugar.
- Reembolso de otro tema (sin "need/request/get…") sigue escalando como antes.

## Tareas
- [x] T-01 `autoreplies.js` (detección, lectura de sí/no, textos) + pruebas · R-01..R-03, R-06
- [x] T-02 Integrar en `ticketops.analyzeMessage` y `statusFromAnalysis` · R-02, R-04
- [x] T-03 Protocolo `refund` en widget, consola y logs · R-07
- [x] T-04 Pruebas de flujo completo en `ticketops.test.js` (CA-01..CA-04); el listener sube a v2.7.0
