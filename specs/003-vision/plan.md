# Plan 003 — Visión: de la foto del chat al panel

> Spec: `./spec.md` · Estado: aprobado · Fecha: 2026-10-09

## Contexto para una IA
El listener descarga la foto del mensaje (en el navegador, con GM_xmlhttpRequest), la reduce y la manda al servidor local. El servidor la lee con OCR local (Python + RapidOCR, sin red), aplica las palabras clave de la KB y guarda los hallazgos del caso. El extractor (spec 002) usa esos hallazgos como si fueran datos del mensaje. El panel muestra la foto con cajas y etiquetas.

## Verificación contra la constitución
| Principio | ¿Cumple? | Cómo |
|---|---|---|
| 1 Humano en el circuito | Sí | La lectura propone; lo dudoso exige confirmación y nada se ejecuta sin el verde |
| 3 La IA propone, el código decide | Sí | OCR determinista + reglas en código; ningún LLM |
| 4 Menor privilegio / datos personales | Sí | La imagen no se guarda; los logs llevan hallazgos, no la foto; el OCR corre en el PC de Juan |
| 7 Barato por defecto | Sí | $0: modelo local |
| 8 Selectores estables | Sí | `img.attachment-img` dentro de `.image-gallery-message` (semánticos, no hasheados) |

## Enfoque técnico
- **Descarga en el navegador**, no en el servidor: evita SSRF y problemas de sesión con el CDN de Connecteam. La imagen se reduce a 1600 px y JPEG 0,85 antes de enviarse (~300–500 KB).
- **OCR:** `tools/vision-lab/ocr_read.py` (RapidOCR sobre ONNX, elegido en T-14 con 5 tickets reales: Receipt Number acertado 5/5). Un proceso por foto, que recibe la imagen por entrada estándar y entrega JSON con texto, posición y confianza por línea.
- **Reglas** en `kb/data/vision-keywords.json` (editable, spec R-04). Se evalúan sobre el texto sin espacios y toleran errores típicos del OCR (`0ctober`, `f1ames`, `#` perdido).
- **Hallazgos → datos:** `local-server/vision.js` convierte líneas en hallazgos (Receipt Number, parque, fecha, línea de flames, `@Arcade amount`, cantidad de brazaletes, últimos 4 de la Play Card, últimos 4 del método de pago que se ignoran) y en "hechos" para el extractor.
- **El servidor recuerda los hallazgos por `caseId`** (en memoria); `analyze_flames` los combina solo. Así el cliente no puede inyectar hechos arbitrarios.
- **Panel:** `<canvas>` con la foto y las cajas por categoría; lista de hallazgos con confianza y de lo no encontrado; clic en un hallazgo resalta su caja.
- Descartado: leer la foto en el servidor con su URL (sin sesión puede fallar y abre SSRF); un LLM con visión (costo y latencia; queda como respaldo futuro).

## Componentes
| Componente | Archivo | Responsabilidad | Requisitos |
|---|---|---|---|
| OCR | `tools/vision-lab/ocr_read.py` | Imagen → líneas con caja y confianza | R-03 |
| Reglas | `kb/data/vision-keywords.json` | Palabras clave editables | R-04 |
| Hallazgos | `local-server/vision.js` | OCR + reglas → hallazgos y hechos | R-04, R-05, R-13, R-14, R-15 |
| Integración | `local-server/flamerequest.js` | Usa los hechos (recibo, parque, flames, brazaletes, últimos 4) | R-09, R-11 |
| Acción | `local-server/server.js` | `read_image` | R-01, R-12 |
| Listener | `userscript/connecteam-listener-v2.user.js` | Captura la foto, la reduce, la envía, dibuja el visor | R-01, R-06, R-07, R-08 |

## Contratos
`read_image` (entrada): `{ action, caseId, imageBase64, mime }`
`read_image` (salida): `{ contract, width, height, ms, lines: [{ text, score, box }], findings: [{ kind, label, text, value, score, box, lowConfidence }], notFound: [kind], facts }`

## Datos y estado
En memoria del servidor: hallazgos por `caseId` (se descartan al cerrar el caso o al reiniciar). En logs: solo hallazgos (`vision`), nunca la imagen. En disco: nada de la foto (el OCR usa entrada estándar).

## Manejo de errores y escalación
| Falla | Detección | Respuesta |
|---|---|---|
| Python o el OCR no disponible | Error del proceso | El panel dice "no pude leer la foto"; el flujo sigue por texto y pregunta |
| OCR lento (> 60 s) | Tiempo máximo | Se corta el proceso; mismo aviso |
| Foto ilegible / baja confianza | Confianza < 0,85 | Hallazgo marcado; el verde exige confirmación |
| Descarga de la foto falla | Error de GM_xmlhttpRequest | Aviso en el panel; se pregunta por texto |

## Estrategia de pruebas
- Unitarias: `vision.test.js` con las líneas de OCR de los 5 tickets reales (sin la foto ni códigos de autorización).
- Integración: lectura real con Python sobre `IMG Training` (se omite si Python no está).
- Humana: foto real en Connecteam; botón "Probar foto" del panel.

## Seguridad
R0 (solo lectura). Entrada acotada (tamaño, tipo). Sin ejecución de código de la imagen. Sin red en el OCR.

## Preguntas abiertas
- Resolución de la miniatura `/mobile/` del CDN: se mide con la foto real de Zarak (ver resultado de la prueba).
