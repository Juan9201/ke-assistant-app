# Spec-Driven Development en KE Assistant

## Flujo
```
constitution ─► spec ─► clarify ─► plan ─► tasks ─► implement ─► analyze
   (qué no se negocia) (QUÉ/POR QUÉ) (dudas) (CÓMO) (pasos) (código+eval) (consistencia)
```
| Fase | Comando | Produce | Regla |
|---|---|---|---|
| Spec | `/sdd-spec <idea>` | `specs/NNN-slug/spec.md` | Solo QUÉ y POR QUÉ; sin tecnología |
| Clarify | `/sdd-clarify` | spec sin `[NECESITA ACLARACIÓN]` | Preguntas a Juan, no suposiciones |
| Plan | `/sdd-plan` | `plan.md` (+ `contracts/`) | Cada decisión cita un requisito y la constitución |
| Tasks | `/sdd-tasks` | `tasks.md` | Tareas pequeñas, ordenadas, con requisito y verificación |
| Implement | `/sdd-implement [T-xx]` | código + tests | Una tarea a la vez; marca `[x]` al verificar |
| Analyze | `/sdd-analyze` | informe de brechas | Solo lectura: spec↔plan↔tasks↔código |

Conocimiento del agente (no es código): `/sdd-runbook` crea runbooks Gravity, `/sdd-eval` crea casos de evaluación.

## Estructura
```
specs/
  constitution.md
  _templates/        ← no editar; se copian
  001-<feature>/
    spec.md  plan.md  tasks.md  contracts/  research.md
  adr/               ← decisiones (ADR-001-...)
```
Numeración: 3 dígitos, secuencial. Una carpeta por capacidad entregable.

## Líneas de caso
Cada tema de soporte (Play Card, Refunds, Bookings, Punch Cards, Memberships, Online tickets, Split payment) es una línea de caso, registrada en `specs/constitution.md` (sección "Líneas de caso"). Para armar una: completa las preguntas abiertas de su `spec.md`, luego `/sdd-clarify` → `/sdd-plan` → `/sdd-tasks`, con su política en `kb/docs/business-logic/`. `local-server/cases.test.js` verifica que el registro, las specs y la KB sean coherentes.

## Convenciones
- Requisitos: `R-01…` · Criterios de aceptación: `CA-01…` · Tareas: `T-01…` · Riesgos: `K-01…`
- Marca `[NECESITA ACLARACIÓN: pregunta]` donde falte información; prohibido adivinar.
- Los specs describen comportamiento observable; los detalles técnicos van en el plan.
- Cada documento comienza con la sección **Contexto para una IA** (qué es, qué leer antes, glosario mínimo).
