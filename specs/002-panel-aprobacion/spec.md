# Spec 002 — Panel de entendimiento, evidencia y aprobación

> Estado: aprobada por Juan (2026-10-05) · **revisada y aprobada 2026-10-08** · Responsable: Juan

## Contexto para una IA
- Qué es esto en una frase: el panel del listener de Connecteam muestra qué entendió el asistente de un pedido de flames, la información capturada, quién lo pidió y la **evidencia leída en Gravity y Amusement**; solo cuando todo cuadra aparece el botón verde con el que Juan aprueba la ejecución de la recarga.
- Leer antes: `specs/constitution.md`, `specs/adr/ADR-001`, `specs/adr/ADR-002`, `kb/docs/business-logic/playcard.md`, spec 003 (visión) y spec 001 (logs).
- Glosario: flames = créditos de juego · Manual Kiosk = pantalla de Amusement para recargar · Receipt Number = número del recibo de Gravity (`#00000000`) · V1 = tarjeta de 10 dígitos · V2 = tarjeta del chat = tarjeta del recibo.

## Problema y motivación
Juan necesita ver qué entendió el asistente y con qué evidencia, y aprobar con un clic, sin ejecutar nada a ciegas. Para validar la solución por ensayo y error, el panel debe mostrar cada paso con su resultado.

## Alcance
Solo "problemas de flames": el pedido llega por Connecteam (`app.connecteam.com`, chat Gravity Support); se valida en Gravity (solo lectura) y se resuelve en Amusement Manual Kiosk (`app.amusementconnect.com/ManualKiosk/ManualKiosk?locationId=<id>&organizationId=<org>`), con la sesión ya iniciada en el Chrome de Juan.

## Ciclo de trabajo (fases)
1. **Entender:** qué pide el staff (texto + foto como un solo contexto, spec 003).
2. **Capturar:** parque, tarjeta, Receipt Number, flames y monto, y quién lo pidió. Si falta algo, pregunta en inglés.
3. **Leer (R0, automático):** Gravity (recibo) y Amusement (historial de la tarjeta).
4. **Evidencia y validaciones:** el panel muestra lo leído y el resultado de cada validación.
5. **Aprobar (botón verde):** solo si todas las validaciones pasan.
6. **Ejecutar (R1):** recarga manual, verificación y registro.
7. **Responder:** propone la respuesta en inglés al autor; Juan la envía.

## Usuarios y escenarios
| Actor | Situación | Resultado deseado |
|---|---|---|
| Staff Kids Empire | Pide recarga de flames con tarjeta, parque y foto del ticket | Recibe la respuesta correcta en inglés |
| Juan (soporte) | Ve el panel con el pedido entendido y la evidencia | Aprueba o niega con un clic |
| Agente | Entiende, captura, lee, valida; ejecuta solo tras la aprobación | Recarga hecha y verificada, o respuesta de aclaración |

## Requisitos funcionales
- **R-01** El panel DEBE mostrar, por cada pedido de flames, **qué entendió** el asistente en una frase corta.
- **R-02** El panel DEBE mostrar la información capturada: **parque** (nombre y locationId), **tarjeta** (10 dígitos), **Receipt Number**, **flames y monto**, y **quién lo pidió** (autor, para poder responderle al final del ciclo).
- **R-03** Si falta un dato (parque, tarjeta o Receipt Number), el panel DEBE proponer la pregunta **en inglés** con la redacción literal de la KB (R-FALTA), pidiendo solo lo que falta; el botón verde NO se habilita.
- **R-04** El Receipt Number se necesita **una sola vez**. Si el ticket lo trae repetido, la repetición no influye en la validez.
- **R-05** El asistente DEBE leer en Gravity el recibo (estado de pago, tarjeta `PLAY_CARD`, línea de flames, fecha) y en Amusement el historial de la tarjeta, y DEBE mostrar esa evidencia en el panel antes del botón verde.
- **R-06** **V2:** si la tarjeta del chat no coincide con la del recibo, el panel DEBE proponer la respuesta literal R-V2 (`It looks like the play card and receipt info doesn't match, feel free to find the correct play card or receipt, thank you!`) y NO habilitar el verde. Si coinciden, se entiende que Gravity falló al cargar (Caso I) y se continúa.
- **R-07** Si la tarjeta ya tiene los flames del recibo, el panel DEBE proponer R-YA-CARGADA y NO habilitar el verde.
- **R-08** Los flames a cargar DEBEN salir de la línea del recibo (no de una tabla). Si el recibo no trae `PLAY_CARD`, no está pagado, está anulado o reembolsado, o tiene varias líneas de flames, el caso se escala (`Allow me take a look`) y el verde queda deshabilitado.
- **R-09** El botón **verde** "Aprobar y ejecutar" solo se habilita si TODAS las validaciones pasan (V1, V2, recibo pagado, flames de la línea del recibo, tarjeta sin esos flames, tope por motivo, no duplicado por Receipt Number). Junto a él hay un botón **Negar** que cierra el pedido sin ejecutar nada.
- **R-10** Al aprobar, un solo clic humano real ejecuta el protocolo de recarga (ADR-002). Sin clic humano no se ejecuta nada.
- **R-11** Antes de pulsar `Credit`, si "Credits Loaded per Card" ≠ flames, el asistente DEBE detenerse, no cargar y avisar en el panel.
- **R-12** Tras la recarga, el asistente DEBE verificar el mensaje de éxito y la nueva entrada en el historial de la tarjeta, y solo entonces registrar el Receipt Number en el registro anti doble recarga.
- **R-13** Al terminar, el panel DEBE mostrar el resultado paso a paso y proponer la respuesta en inglés al autor (R-OK), como respuesta al mensaje original; Juan la revisa y la envía.
- **R-14** Parque, tarjeta, Receipt Number, flames y monto DEBEN poder corregirse en el panel; al corregir, se re-evalúan todas las validaciones.
- **R-15** Hay **dos protocolos**, elegidos por el contenido del pedido (sin selector de modos):
  - **Test card:** solo si el pedido dice `test` junto con `card`. Es uso administrativo (probar máquinas): sin recibo y sin consultar Gravity; se carga la tarjeta dada **siempre con `$10 = 50 flames`**; antes de cargar se comprueba que nadie lo haya atendido (chat y `cardScanReports`). Si el pedido no dice `test`, esta regla no aplica ni se activa el protocolo.
  - **Con recibo:** el ciclo normal (R-05 a R-13).
- **R-16** Cada paso y resultado DEBE quedar en los logs (spec 001).
- **R-17** **Toda respuesta o pregunta al staff DEBE nombrar a quien se le responde, sin excepción** (`Hello Rashel, …`, sin el rango), incluidas las preguntas por datos faltantes y las escalaciones.
- **R-18** La validación en Gravity DEBE seguir este recorrido: parque del recibo → `Reports` → `pos-transaction` → fecha → pegar el Receipt Number → comprobar que `Transaction #` es el mismo número (Receipt Number = Transaction #) → buscar `PLAY_CARD` → comparar con la tarjeta del chat (V2).
  *Implementación (2026-10-09): la lectura usa la API de Gravity que alimenta esa pantalla (`GET /api/CheckOut/transactionDetail/{n}/maskCardNumber/false/true`, que acepta el Receipt Number directo, sin parque ni fecha) desde un lector en la pestaña de Gravity, y no navega por la pantalla: Gravity redirige a otro parque al navegar por URL. `Transaction #` = Receipt Number; `PLAY_CARD` = `gpCards[].code` de las tarjetas de flames. El parque, los flames y el monto salen del recibo; el resultado solo vale para el Receipt Number consultado.*
- **R-19** Los flames se toman de la lista de equivalencias ya establecida o del `@Arcade amount` impreso en el ticket, nunca de un cálculo propio con el monto pagado.
- **R-20** Un mensaje sobre una tarjeta dañada o que no escanea NO es un pedido de flames: no activa este protocolo y se escala con `Allow me take a look`.

## Requisitos no funcionales
- **Seguridad:** la recarga es R1 (ADR-001 enmendada por ADR-002); reembolsos y anulaciones son R2 y escalan. Secretos: aplica la cláusula de fase de validación.
- **Costo:** el flujo de flames no usa IA para extraer ni validar (código determinista). La visión se rige por la spec 003.
- **Fiabilidad:** si falta sesión o no se encuentra un elemento de pantalla, el protocolo se detiene y lo dice en el panel; nunca reintenta una carga.
- **Observabilidad:** logs de cada paso con sistema permitido (`connecteam`, `gravity`, `amusement`).

## Fuera de alcance
- Reembolsos, anulaciones y otros temas distintos de flames.
- Gestión de secretos y despliegue en otro PC (al final).
- Commits/push durante la fase de validación.

## Criterios de aceptación
- **CA-01** Dado un pedido con parque, tarjeta y Receipt Number válidos que coinciden con el recibo de Gravity pagado, y sin recarga previa, cuando termina la lectura, entonces el panel muestra entendimiento, datos, quién lo pidió y la evidencia, con el verde habilitado (R-01, R-02, R-05, R-09).
- **CA-02** Dado un pedido sin Receipt Number, entonces se propone la pregunta literal de la KB y el verde está deshabilitado (R-03).
- **CA-03** Dada una tarjeta de 9 u 11 dígitos, entonces el verde está deshabilitado y se pide revisar la secuencia (R-09).
- **CA-04** Dada una tarjeta del chat distinta de la del recibo, entonces se propone la respuesta R-V2 literal y el verde queda deshabilitado (R-06).
- **CA-05** Dado un Receipt Number que aparece dos veces en la foto, entonces se acepta con una sola lectura válida (R-04).
- **CA-06** Dada una tarjeta que ya tiene los flames del recibo, entonces se propone R-YA-CARGADA (R-07).
- **CA-07** Al pulsar Negar, no se ejecuta nada (R-09).
- **CA-08** Al aprobar con "Credits Loaded per Card" distinto de flames, el protocolo se detiene antes de `Credit` y lo muestra (R-11).
- **CA-09** Al aprobar un caso válido, se ve el avance paso a paso, el resultado y la respuesta R-OK propuesta para el autor (R-10, R-12, R-13).
- **CA-10** El mismo Receipt Number aprobado dos veces no recarga dos veces (R-09, R-12).
- **CA-11** Un recibo sin campo `PLAY_CARD` escala con `Allow me take a look` (R-08).
- **CA-12** Un pedido con `test` y `card` propone cargar `$10 = 50 flames` sin consultar Gravity; el mismo pedido sin `test` no activa ese protocolo (R-15).
- **CA-13** Toda pregunta o respuesta propuesta empieza nombrando a la persona (p. ej. `Hello Rashel,`) (R-17).
- **CA-14** El mensaje "the card is bent and won't scan" no genera un pedido de flames y se escala (R-20).

## Casos límite y escalaciones
| Caso | Comportamiento |
|---|---|
| Datos incompletos | Pregunta en inglés (literal de la KB); no ejecutar |
| Foto ilegible o lectura dudosa | Pedir una foto más clara o permitir corregir el dato (spec 003) |
| Sesión de Gravity/Amusement caducada | Detener y avisar en el panel |
| Gravity redirige a otro parque | Verificar el parque tras navegar; si no coincide, detener |
| Parque sin locationId (Miami) | Verde deshabilitado, se explica el motivo |
| Reembolso u otro tema | Escalar con `Allow me take a look` |

## Riesgos y supuestos
- **K-01** La carga del Manual Kiosk tiene un quirk (el monto a veces hay que reescribirlo); R-11 lo cubre.
- **K-02** Se asume la sesión de Chrome iniciada en Connecteam, Gravity y Amusement.
- **K-03** El motivo (`test_card` o `webhook_failed`) se deduce por ahora de la palabra "test" en el mensaje.

## Checklist de revisión
- [x] Sin tecnología ni código en esta spec
- [x] Todo R-xx tiene al menos un CA-xx (R-14 y R-16 se verifican a mano y con la spec 001)
- [x] Cero `[NECESITA ACLARACIÓN]` pendientes
- [x] No contradice la constitución
