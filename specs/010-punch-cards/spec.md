# Spec 010 — Línea de caso: Punch Cards

> Estado: **borrador (espacio creado 2026-10-10)** · Responsable: Juan

## Contexto para una IA
- Qué es esto en una frase: mensajes del staff sobre punch cards (tarjetas de visitas/entradas por perforación).
- Es una **línea de caso** (ver "Líneas de caso" en `specs/constitution.md`): su propio protocolo, aparte de las demás. NO debe cambiar el comportamiento de Play Card ni de Refunds.
- Leer antes: `specs/constitution.md` (reglas comunes de las líneas de caso, R0/R1/R2), spec 008 (ejemplo de línea con respuestas automáticas), `kb/docs/business-logic/punch-cards.md`.
- Mientras esta spec no esté **aprobada**, el asistente NO responde solo a este tema: lo escala con `Allow me take a look` (principio 2).

## Problema y motivación
[NECESITA ACLARACIÓN: qué duele hoy en esta línea y cómo se atiende a mano]

## Reglas dictadas por Juan
(Aún ninguna. Se agregan aquí tal cual las dicte Juan, con la frase del staff, la respuesta literal y el siguiente paso.)

## Preguntas abiertas
- [NECESITA ACLARACIÓN: ¿qué mensajes del staff activan este caso? (frases de ejemplo reales)]
- [NECESITA ACLARACIÓN: ¿qué datos se piden si faltan, y con qué texto literal en inglés?]
- [NECESITA ACLARACIÓN: ¿qué se consulta en Gravity (solo lectura, R0) y qué decide el asistente con eso?]
- [NECESITA ACLARACIÓN: ¿cuándo se escala con `Allow me take a look`?]
- [NECESITA ACLARACIÓN: ¿la conversación continúa (el staff responde y el asistente reacciona), como en reembolsos?]
- [NECESITA ACLARACIÓN: ¿alguna acción cambia algo (R1) o mueve dinero/datos (R2)? Si sí, hace falta un ADR]
- [NECESITA ACLARACIÓN: ¿cómo se distingue una Punch Card de una Play Card en el mensaje y en Gravity?]
- [NECESITA ACLARACIÓN: ¿qué problemas se reportan (no carga, saldo, duplicada) y cómo se resuelve cada uno?]

## Requisitos funcionales
(Se escriben cuando estén resueltas las preguntas abiertas: `R-01…`, cada uno con su `CA-xx`.)

## Criterios de aceptación
(Pendientes.)

## Tareas
(Pendientes: se generan con `/sdd-plan` y `/sdd-tasks` cuando la spec esté aprobada.)

## Checklist de revisión
- [ ] Cero `[NECESITA ACLARACIÓN]` pendientes
- [ ] Todo R-xx tiene al menos un CA-xx
- [ ] Política en `kb/docs/business-logic/punch-cards.md` completa y con eval
- [ ] No contradice la constitución ni cambia otras líneas (sus pruebas pasan sin cambios)
