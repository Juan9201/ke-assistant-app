---
description: SDD 4/6 — descomponer el plan en tasks.md ordenadas y verificables
argument-hint: [carpeta NNN-slug]
---
Carpeta: $ARGUMENTS (por defecto la más reciente).

1. Lee `spec.md` y `plan.md`.
2. Crea `tasks.md` desde `specs/_templates/tasks.md`. Los tests/evals de cada requisito van ANTES de su implementación.
3. Cada tarea: pequeña, con archivos, requisito R-xx y verificación concreta. Marca `[P]` las paralelizables.
4. Completa la tabla de trazabilidad: ningún R-xx puede quedar sin tareas.
5. Sugiere `/sdd-implement T-01`.
