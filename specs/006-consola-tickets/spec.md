# Spec 006 — Consola de tickets (operar KE Assistant desde `/tickets` y verlo reflejado en Connecteam)

> Estado: **aprobada por Juan (2026-10-09, "se debe construir tickets")** · Responsable: Juan

## Contexto para una IA
- Qué es esto en una frase: una página local donde cada pedido de Connecteam es un **ticket** con su conversación, lo que entendió y leyó el asistente, sus logs y la respuesta; desde ahí se **opera** (corregir datos, aprobar, responder) y lo respondido **aparece en el chat de Connecteam citando al staff**. Funciona en paralelo con el widget del listener.
- Leer antes: `specs/constitution.md` (principios 1, 5, 6), specs 001 (logs), 002 (panel), 003 (visión), 005 (resiliencia, por escribir).
- Glosario: ticket = un pedido de un staff (puede reunir varios mensajes suyos) · espejo = copia de lo que el listener captura de Connecteam · comando = orden de la consola que ejecuta el listener dentro de Connecteam · estado = en qué punto está el ticket.

## Problema y motivación
Hoy cada pedido vive en una tarjeta del widget (máximo 6, se pierden al recargar), y la respuesta del staff a una pregunta del asistente ("¿en qué parque estás?") llega como un mensaje nuevo sin contexto. Juan necesita ver todos los pedidos en orden de llegada, entender qué hace el asistente en cada uno, y operar desde un solo lugar.

## Requisitos funcionales
- **R-01** Cada pedido de flames DEBE crear un **ticket persistente en el servidor local** (sobrevive a recargar Connecteam o reiniciar el servidor), con número de llegada.
- **R-02** Los mensajes posteriores del **mismo autor** mientras el ticket espera al staff (dentro de 45 minutos) DEBEN sumarse al mismo ticket, y el asistente DEBE analizar el conjunto (así "Arlington" completa el pedido que preguntaba el parque).
- **R-03** La consola DEBE listar los tickets **por orden de llegada** con estado, autor y número, y permitir filtrar por estado y buscar texto.
- **R-04** Al elegir un ticket DEBE mostrar la **conversación** (mensajes del staff con sus fotos, lo propuesto por el asistente y lo que Juan insertó o envió), **lo que entendió** con los datos capturados editables, la **evidencia** de Gravity con su veredicto, y los **logs** del caso.
- **R-05** Desde la consola se DEBE poder **corregir** parque, tarjeta, recibo, flames y monto; cada corrección re-evalúa todas las validaciones.
- **R-06** Desde la consola se DEBE poder **escribir o editar la respuesta** al staff y **insertarla en el cuadro de Connecteam como respuesta citando el mensaje del staff**, nombrando a la persona (spec 002, R-17).
- **R-07** Desde la consola se DEBE poder **enviar** esa respuesta en Connecteam, solo si ya se insertó exactamente ese texto y tras una confirmación explícita de Juan en la consola (principio 1: una persona decide el envío; nunca se envía sola).
- **R-08** El estado de cada comando (pendiente, ejecutado, falló y por qué) DEBE verse en la consola; si Connecteam no está abierto en el chat correcto, DEBE decirlo.
- **R-09** La consola DEBE permitir **aprobar** o **negar** el protocolo (botón verde de la spec 002, habilitado solo con las mismas condiciones) y **marcar el ticket como resuelto**.
- **R-10** El widget y la consola DEBEN compartir el mismo estado: lo que se hace en uno se ve en el otro.
- **R-11** El servidor DEBE pedir solo la lectura a Gravity cuando el ticket tenga Receipt Number, sin depender de que el widget esté abierto, y re-evaluar el ticket cuando llegue la lectura o la foto.
- **R-12** La consola es una **página aparte** (`http://127.0.0.1:8787/tickets`): solo Host local, sin CORS, y NO se inyecta en el DOM de Connecteam. Sus acciones de escritura exigen el secreto, que el servidor inyecta al entregar la página.
- **R-13** Todo lo que se hace desde la consola DEBE quedar en los logs del caso.

## Fuera de alcance
- Incrustar la página real de Connecteam (no verificado y probablemente bloqueado por el sitio): se usa un **espejo** de lo que el listener captura.
- Enviar mensajes sin una persona, y ejecutar la recarga en Amusement (spec 002, T-11 a T-13).

## Criterios de aceptación
- **CA-01** Un mensaje de flames crea un ticket que aparece en la consola; recargar Connecteam o reiniciar el servidor no lo borra (R-01).
- **CA-02** Si el asistente pregunta el parque y el mismo staff responde "Arlington", ese mensaje se suma al mismo ticket y el ticket queda completo (R-02).
- **CA-03** Al escribir una respuesta en la consola y pulsar "Insertar en Connecteam", el texto aparece en el cuadro de Connecteam citando el mensaje del staff, y no se envía (R-06).
- **CA-04** "Enviar" solo funciona si el texto insertado coincide exactamente con el del cuadro y Juan confirmó; si el cuadro cambió, no se envía y se explica (R-07).
- **CA-05** Con Connecteam cerrado o en otro chat, el comando falla con un mensaje claro y la consola lo muestra (R-08).
- **CA-06** Corregir un dato en la consola actualiza validaciones y respuesta propuesta; el widget refleja lo mismo (R-05, R-10).
- **CA-07** Con el Receipt Number presente, el servidor pide la lectura a Gravity por su cuenta y el ticket se actualiza cuando llega (R-11).
- **CA-08** Una página externa no puede leer `/api/tickets` ni ejecutar comandos sin el secreto (R-12).
- **CA-09** Cada inserción, envío, corrección y aprobación queda en `/logs` (R-13).

## Riesgos y supuestos
- **K-01** El listener debe estar abierto en el chat de Connecteam para ejecutar comandos; el puente depende de esa pestaña.
- **K-02** El mensaje a citar se identifica por su id de Connecteam y, si no coincide, por su contenido (en casos reales dos mensajes compartieron id).
- **K-03** La foto se muestra desde su URL pública de Connecteam; no se guarda copia (privacidad, spec 003). Los tickets guardan texto, URLs y datos operativos, no datos de pago.
