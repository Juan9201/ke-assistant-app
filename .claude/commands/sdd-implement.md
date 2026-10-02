---
description: SDD 5/6 — implementar una tarea de tasks.md (una a la vez)
argument-hint: [T-xx] [carpeta NNN-slug]
---
Entrada: $ARGUMENTS

1. Lee `tasks.md`; si no se indicó tarea, toma la primera sin marcar cuyas dependencias estén cumplidas.
2. Relee el R-xx de la tarea en `spec.md` y las decisiones en `plan.md`.
3. Implementa SOLO esa tarea, con el estilo del código vecino. No agregues funciones fuera de la spec; si la spec está incompleta o contradice la realidad, detente, actualiza la spec/plan y avisa.
4. Ejecuta la verificación indicada (tests, evals, prueba manual) y reporta el resultado real.
5. Solo si verifica, marca `[x]` en `tasks.md`. Nunca imprimas secretos de `.env`.
6. Resume qué cambió y propone la siguiente tarea.
