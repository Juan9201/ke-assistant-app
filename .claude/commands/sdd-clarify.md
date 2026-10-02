---
description: SDD 2/6 — resolver los [NECESITA ACLARACIÓN] de una spec preguntando a Juan
argument-hint: [carpeta NNN-slug, por defecto la más reciente]
---
Spec objetivo: $ARGUMENTS (si está vacío, usa la carpeta más reciente de `specs/`).

1. Lee `spec.md` y reúne todos los `[NECESITA ACLARACIÓN]` y ambigüedades (requisitos sin criterio, términos vagos, riesgos sin clasificar R0/R1/R2).
2. Pregunta a Juan en bloques de máximo 4 preguntas, con opciones y una recomendación.
3. Con cada respuesta, actualiza la spec y quita la marca. Registra las decisiones en una sección "Decisiones" al final.
4. Cuando no quede ninguna marca, cambia el estado a "clarificada" y sugiere `/sdd-plan`.
