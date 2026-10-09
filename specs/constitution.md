# Constitución — KE Assistant

> Versión 1.0 · Responsable: Juan · Cambios solo vía ADR (`specs/_templates/adr.md`).
> Si una spec, plan o tarea contradice este documento, gana este documento.

## Principios innegociables
1. **Humano en el circuito (human in the loop).** El sistema propone; una persona aprueba antes de que se ejecute cualquier acción que cambie algo. Mensajes a Connecteam: una persona revisa y envía, nunca se envían solos. Acciones en sistemas (p. ej. recarga de flames): la persona aprueba el protocolo completo con un clic (botón verde del panel) y el clic de aprobación es la decisión humana; las guardas por código siguen mandando y pueden detener la ejecución aunque se haya aprobado (ADR-002).
2. **La KB es la fuente de verdad.** Si la KB no respalda algo, la respuesta es literalmente `Allow me take a look`. Nada de conocimiento externo ni suposiciones. Excepción: si el caso está cubierto por la KB pero faltan datos (tarjeta, parque, flames), el asistente pregunta en inglés qué falta; eso no es una escalación.
3. **La IA propone, el código decide.** Riesgo, autonomía, límites y aprobaciones se aplican en código determinista, no en el prompt.
4. **Menor privilegio.** Lectura antes que escritura; las acciones irreversibles o con dinero/seguridad/datos personales siempre escalan.
5. **Secretos fuera de todo.** Ni en código de navegador, ni en KB, ni en specs, ni en trazas. Sesiones de Gravity/Connecteam solo en perfil local del navegador.
6. **Reproducible y auditable.** Cada caso guarda traza con el sha de la KB usada; un comportamiento se puede reconstruir y evaluar.
7. **Barato por defecto.** Listener sin IA; modelo barato para clasificar; modelo fuerte solo si no hay runbook. Preferir endpoint interno > runbook determinista > agente exploratorio. Excepción: un modelo con visión se usa únicamente cuando el mensaje trae imagen (foto del ticket); el texto sin imagen sigue con el modelo barato.
8. **Selectores estables.** Roles, labels y atributos semánticos; nunca clases hasheadas.
9. **Idioma.** Respuestas a clientes siempre en inglés; documentación interna en español.
10. **Spec antes que código** (ver `specs/README.md`).

## Niveles de riesgo de acciones
| Nivel | Definición | Política |
|---|---|---|
| R0 | Lectura | Puede ejecutarse sola |
| R1 | Escritura reversible | Requiere aprobación humana (hasta ganar autonomía por evals) |
| R2 | Irreversible, dinero, seguridad, datos personales | Siempre escala |

Excepción acordada (ADR-001, enmendada por ADR-002): la **recarga manual de flames** es R1 con guardas obligatorias y aprobación humana del protocolo completo mediante el botón verde del panel; el clic en `Credit` lo ejecuta el protocolo, no una segunda aprobación. Reembolsos y anulaciones siguen siendo R2. La excepción aplica solo a ese flujo: el principio 4 ("siempre escalan") rige para todo lo demás.

## Interlocutores
Las respuestas son siempre para el **staff** del parque; el asistente nunca se dirige al huésped.
Todo caso fuera de lo descrito en la KB se escala con `Allow me take a look` y queda registrado en la cola de escalaciones para que Juan decida cómo automatizarlo.

## Fase de validación (vigente desde 2026-10-05)
Mientras se valida la solución por ensayo y error en el PC de Juan: se toleran secretos locales (`.env`, userscript), no se hace commit/push y los evals son recomendados, no bloqueantes. Se mantienen sin excepción: humano en el circuito, guardas por código y la regla de no enviar mensajes solos. **Antes de desplegar en otro PC** se exige el cumplimiento total: principio 5 (secretos), evals en verde, rotación del `SHARED_SECRET` y commit. Esta cláusula se elimina cuando esa condición se cumpla.

## Definición de "terminado"
Requisitos cumplidos y trazables · evals en verde · sin secretos · spec/plan/tasks actualizados · CHANGELOG de la KB si cambió conocimiento.

## Registro de enmiendas
| Fecha | ADR | Cambio |
|---|---|---|
| 2026-10-02 | ADR-001 | Recarga manual de flames pasa de R2 a R1 con guardas y aprobación humana |
| 2026-10-05 | ADR-002 | Aprobación humana pasa del clic final en `Credit` al botón verde que aprueba el protocolo completo; guardas por código se mantienen |
| 2026-10-05 | — | Principio 1 reformulado a "human in the loop"; principio 2 permite preguntar datos faltantes; principio 7 permite visión solo con imagen; se agrega la cláusula de fase de validación |
