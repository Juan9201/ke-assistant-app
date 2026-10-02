---
description: SDD 3/6 — generar plan.md técnico desde una spec clarificada
argument-hint: [carpeta NNN-slug] [restricciones técnicas]
---
Entrada: $ARGUMENTS

1. Lee `spec.md` (debe estar "clarificada"; si no, detente y pide `/sdd-clarify`), `specs/constitution.md` y el código existente relevante en `local-server/`, `userscript/`, `kb/`.
2. Crea `plan.md` desde `specs/_templates/plan.md`. Completa la tabla de verificación contra la constitución; si algo no cumple, justifícalo o cambia el enfoque.
3. Cada componente referencia los R-xx que cubre. Define contratos JSON en `contracts/`. Si hay una decisión importante, crea un ADR en `specs/adr/`.
4. Reutiliza lo existente (p. ej. `callLLM`, `decide()`, `conversations.js`) antes de proponer piezas nuevas.
5. No escribas código de producción. Sugiere `/sdd-tasks`.
