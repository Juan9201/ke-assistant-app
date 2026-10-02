---
description: SDD 6/6 — auditoría de consistencia spec ↔ plan ↔ tasks ↔ código (solo lectura)
argument-hint: [carpeta NNN-slug]
---
Carpeta: $ARGUMENTS (por defecto la más reciente).

SOLO LECTURA: no modifiques archivos.
Revisa y reporta en tabla (hallazgo, severidad, archivo, sugerencia):
1. R-xx sin CA-xx, sin tareas, o sin código que los cumpla.
2. Tareas o código sin requisito que los justifique (alcance añadido).
3. Violaciones de `specs/constitution.md` (envío autónomo, secretos, acciones R2 automatizadas, selectores hasheados).
4. Contradicciones entre spec, plan y tasks.
5. Marcas `[NECESITA ACLARACIÓN]` o tareas sin verificar.
Cierra con un veredicto: listo / listo con observaciones / bloqueado.
