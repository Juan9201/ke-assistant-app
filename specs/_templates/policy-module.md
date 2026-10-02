# <Tema>

> Última revisión: AAAA-MM-DD · Responsable: Juan
> Copiar a `kb/docs/business-logic/<tema>.md`. UN archivo por tema/problema.
> Aquí es donde se explica la lógica de negocio: de este archivo salen los specs, runbooks y evals.

## Qué hace
En una o dos frases: qué problema de soporte resuelve este módulo.

## Matching (¿este mensaje es de este tema?)
Sin distinguir mayúsculas/minúsculas ni acentos. El código lo evalúa primero (gratis, sin IA); la IA confirma.
- **Palabras o frases que lo activan (cualquiera):** `play card`, `flames`, `…`
- **Frases adicionales por contexto (todas deben aparecer):** `…`
- **Palabras que lo DESCARTAN (si aparecen, no es este tema):** `…`
- **Sinónimos / cómo lo escriben las sucursales:** `…`
- **Ejemplos de mensajes que SÍ son de este tema:** "…"
- **Ejemplos que parecen pero NO son (van a otro módulo o escalan):** "…"

## Sistemas involucrados
Marca los que se usan: [ ] Connecteam · [ ] Gravity · [ ] Amusement Connect

## Datos requeridos para empezar
| Dato | Obligatorio | Cómo se reconoce en el mensaje | Ejemplo |
|---|---|---|---|
| Sucursal | sí | nombre de ciudad/ubicación | Dallas |
| Número de tarjeta | sí | 8–12 dígitos | … |

### Si falta algún dato
Pedir SOLO lo que falta, en inglés, amable y breve. No ejecutar nada hasta tenerlo.
> "Hello {name}, to look into this I need: {missing_fields}. Thank you!"

## Pasos de solución
Escritos como los haces tú hoy, numerados. Cada paso indica sistema, acción y qué se debe ver al terminar.
1. **[Sistema]** Acción… → *Evidencia esperada:* …
2. **[Sistema]** Acción… → *Evidencia esperada:* …
3. …

Si un paso falla o el resultado no coincide con lo esperado → detenerse y escalar.
Detalle ejecutable (selectores, endpoints): `kb/runbooks/<tema>.yaml`.

## Cómo se confirma que quedó resuelto
Evidencia observable (qué ves en el sistema) que prueba que el requerimiento se cumplió.
- 

## Clase de riesgo de los pasos
R0 lectura · R1 escritura reversible (pide tu OK) · R2 dinero/seguridad/datos personales (siempre escala)
Indica la clase de cada paso: 

## Excepciones
- 

## Nivel de autonomía permitido a la IA
<!-- Opciones: puede responder sola | con aviso | siempre debe escalar -->
**Nivel:** siempre debe escalar

## Respuesta al solicitante (inglés)
- Al iniciar (si aplica): "…"
- Al resolver: "Hello {name}, {result}. Let us know if you need anything else."
- Si no se pudo resolver: `Allow me take a look`

## Registro de la ejecución (log para auditar y mejorar)
Cada caso deja una traza con: mensaje original · tema detectado y por qué (palabras que calzaron) · datos extraídos y faltantes · razonamiento y plan · cada paso ejecutado con su evidencia · verificación · respuesta enviada · versión de la KB usada.
Campos adicionales que este tema necesita registrar: 

## Errores comunes de quien recién empieza
- 

## Casos reales (alimentan los evals)
- **Mensaje:** "…"
  **Datos presentes / faltantes:** …
  **Qué se hizo:** …
  **Respuesta correcta:** "…"
