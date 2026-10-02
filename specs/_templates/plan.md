# Plan NNN — <nombre>

> Spec: `./spec.md` · Estado: borrador | aprobado · Fecha: AAAA-MM-DD

## Contexto para una IA
Resumen técnico en 3 líneas y archivos del repo que se tocarán.

## Verificación contra la constitución
| Principio | ¿Cumple? | Cómo |
|---|---|---|
| 1 Humano en el último paso | | |
| 3 La IA propone, el código decide | | |
| 5 Secretos fuera de todo | | |
| 7 Barato por defecto | | |

## Enfoque técnico
Descripción de la solución y alternativas descartadas (con motivo).

## Componentes
| Componente | Archivo/ruta | Responsabilidad | Requisitos |
|---|---|---|---|
| | `local-server/…` | | R-01 |

## Contratos entre etapas
Esquemas JSON de entrada/salida (detallar en `contracts/`).
```json
{ "stage": "plan", "input": {}, "output": {} }
```

## Datos y estado
Qué se persiste, dónde, cuánto tiempo, qué nunca se persiste.

## Manejo de errores y escalación
| Falla | Detección | Respuesta |
|---|---|---|
| LLM no responde / JSON inválido | | Escalar |
| Gravity cambia la UI | | Detener, trazar, escalar |

## Estrategia de pruebas
- Unitarias:
- Evals (`kb/evals/`):
- Verificación manual con Juan:

## Seguridad
Riesgos R0/R1/R2 de cada acción; superficie expuesta; manejo de sesión.

## Migración / despliegue
Pasos, reversión.

## Preguntas abiertas
- 
