# 008 · Respuestas automáticas: pedido de reembolso — Aprobada

> Estado: **aprobada por Juan (2026-10-10, reglas dictadas en chat)** · Responsable: Juan

## Contexto para una IA
- Primer caso de "más respuestas automáticas" por mensaje (después de flames). Cada una es una regla determinista (sin IA) que propone una respuesta; **una persona la revisa y envía** (principio 1).
- Leer antes: `specs/constitution.md` (R2: reembolsos siempre escalan), spec 006 (tickets).
- **Es un caso aparte de flames** ("preguntas de reembolso", `caseType: "refund"`, `isFlameRequest: false`): vive en `refundcase.js` y `autoreplies.js`, el listener lo muestra con su propia tarjeta, y NO modifica la lógica de flames (ticketops solo tiene un enganche que, si el mensaje no es de reembolso, deja el flujo de flames idéntico; lo prueba la suite de flames sin cambios).
- Convive con la regla vieja de flames ("reembolso + tarjeta/flames → escalar"): la nueva regla manda cuando el mensaje es un **pedido de reembolso** (R-01); lo demás sobre reembolsos sigue escalando.

## Reglas dictadas por Juan
**Regla general (2026-10-10): toda respuesta se dirige por su nombre a quien preguntó** (primera palabra del nombre, sin rango, spec 007). Las reglas de abajo se muestran con `[nombre]`; la 2, la 3 y la 5 también lo llevan ("Rashel, thank you so much! We will review it."; el texto sigue con minúscula tras el nombre).

1. El staff pide un reembolso ("needs a refund", "we need a refund processed", "can we get a refund?", "I am requesting a refund") → responder **siempre con el nombre**: `[nombre], did you submit the refund request, correct?`
2. Si responde que sí ("yes", "Yes did", cualquier afirmación) → `Thank you so much! We will review it.`
3. Si responde que no → `Understood, feel free to do so!! Thank you.`
4. (2026-10-10) Si el staff **avisa que ya envió** la solicitud ("We just submitted a refund request", "I just submitted a refund", "I submitted a refund", "Refund has been submitted", "refund has already been submitted") → `[nombre], thank you so much! We will review your case`
5. (2026-10-10) Si **pregunta cómo va** ("How long takes", "Any update with this refund", "Guest is waiting for refund", "any word with this update") → `To be transparent, we handle a high volume of refund requests, so there is a slight queue at the moment. However, we’re working as quickly as possible to process yours! Feel free to let our guest know that they’ll receive an email notification as soon as it’s completed`

## Requisitos
- **R-01** Un mensaje que **pide** un reembolso (necesitar/querer/pedir/procesar/conseguir un "refund") DEBE crear un ticket de protocolo `refund` con la pregunta de la regla 1, con el nombre sin rango (spec 007). Mensajes que solo mencionan un reembolso ya hecho ("was refunded", "refund request submitted") o lo niegan ("don't need a refund") NO la activan.
- **R-02** La respuesta del **mismo staff** dentro de 45 min (spec 006, R-02) DEBE leerse como respuesta a esa pregunta: afirmativa → regla 2; negativa → regla 3. Las respuestas son literales y todas llevan el nombre de quien preguntó.
- **R-03** Una respuesta corta que no es ni sí ni no, o con ambos ("no, yes"), NO genera respuesta: el ticket se escala a Juan. Un mensaje largo o con pregunta ("what form?") no se toma como respuesta y sigue su flujo normal.
- **R-04** Estados: pregunta hecha → `waiting_staff`; "sí" → `escalated` (Juan revisa el reembolso); "no" → `resolved`; aviso de envío → `resolved`; pregunta por el estado → `escalated`; respuesta no clara → `escalated`.
- **R-05** El asistente NUNCA ejecuta ni promete un reembolso: solo pregunta y avisa "We will review it" (R2 intacto; la revisión y la decisión son de una persona).
- **R-06** La respuesta se **inserta** (nunca se envía sola) como en flames; los textos van en una sola línea (insertar saltos de línea en el cuadro de Connecteam puede enviar el mensaje).
- **R-08** (regla 4) Un aviso de que ya se envió la solicitud, con o sin pregunta previa, DEBE responder con el nombre y **cerrar** el ticket (`resolved`). Un aviso negado ("have not submitted") no cuenta.
- **R-09** (regla 5) Una pregunta por el estado DEBE responder con el texto de la cola, con el nombre y sin fecha prometida, y sumarse al reembolso reciente del mismo staff (menos de 2 h). Sin la palabra "refund" ("how long takes", "any word with this update") solo cuenta si ese staff tiene un reembolso reciente y el mensaje no es de flames.
- **R-07** Todo queda en `/logs` y el ticket aparece en la consola `/tickets` con el protocolo "Reembolso".

## Criterios de aceptación
- **CA-01** "AM Rashel Carswell: we need a refund processed" → ticket #N `waiting_staff` y respuesta `Rashel, did you submit the refund request, correct?`
- **CA-02** Las cuatro frases de Juan activan la regla; "the guest was refunded" y "no need for a refund" no.
- **CA-03** Después: "Yes did" → `Thank you so much! We will review it.` y ticket `escalated`; "No" → `Understood, feel free to do so!! Thank you.` y ticket `resolved`; "maybe" → escalado sin respuesta.
- **CA-05** "We just submitted a refund request" → `Rashel, thank you so much! We will review your case`, ticket cerrado (R-08).
- **CA-06** "Any update with this refund" → texto de la cola; "any word with this update" solo con un reembolso reciente del mismo staff (R-09).
- **CA-04** Un mensaje de flames del mismo autor tras una pregunta de reembolso no se mezcla con ese ticket.

## Decisiones de Juan
- Redacción: "did you submit" (corregida por Juan; vive en `REFUND_TEXTS` de `autoreplies.js`).
- R2: estas respuestas solo preguntan e informan qué hacer; no ejecutan ni prometen nada, así que no violan R2. Lo que sí sería R2 es ejecutar transacciones.
- Todas las respuestas llevan el nombre del staff que preguntó (corrección de Juan 2026-10-10; antes la confirmación, el "no" y la cola salían sin nombre).
- El aviso de que ya envió la solicitud (regla 4) **cierra** el ticket (`resolved`), no lo escala (corrección de Juan 2026-10-10).

## Supuestos
- **"I am requesting a refund"** aparece en la lista de la regla 1 (pedido → pregunta) y en la de la regla 4 (aviso de envío): son opuestas. Se mantiene en la regla 1 (pedido). Si Juan lo quiere como aviso de envío, se mueve de lista en `autoreplies.js`.
- Los textos dictados en dos párrafos van en una sola línea (R-06). El texto de la regla 4 se respeta literal, sin punto final.
- Reembolso de otro tema (sin "need/request/get…") sigue escalando como antes.

## Tareas
- [x] T-01 `autoreplies.js` (detección, lectura de sí/no, textos) + pruebas · R-01..R-03, R-06
- [x] T-02 Integrar en `ticketops.analyzeMessage` y `statusFromAnalysis` · R-02, R-04
- [x] T-03 Protocolo `refund` en widget, consola y logs · R-07
- [x] T-04 Pruebas de flujo completo en `ticketops.test.js` (CA-01..CA-04); el listener sube a v2.7.0
