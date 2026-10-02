# Proyecto: Asistente de soporte interno — Kids Empire / Foxihost

## Contexto y objetivo

Juan es "product support" (no dev) para Foxihost, atendiendo requerimientos de Kids Empire
que llegan por un canal de Connecteam ("Gravity Support"). El objetivo es un pipeline que:

1. Detecta mensajes nuevos en el chat de Connecteam (sin usar IA — costo $0).
2. Cuando el mensaje es de otra persona, lo manda a interpretar contra una base de
   conocimiento de negocio versionada en GitHub.
3. Un modelo de IA barato (DeepSeek por defecto, intercambiable) responde SOLO si la
   base de conocimiento lo respalda; si no, responde literalmente "Allow me take a look".
4. La respuesta se inserta en el cuadro de texto de Connecteam para que Juan la revise y
   la envíe él mismo — el sistema NUNCA envía mensajes de forma autónoma. Esto es una
   decisión deliberada de seguridad/confianza: los errores en soporte a un canal de 1839
   miembros pueden tener consecuencias reales (reembolsos, seguridad de máquinas, etc.).

## Decisiones de arquitectura ya tomadas (no las reabras sin razón)

- **Listener sin IA**: un userscript de Tampermonkey (`MutationObserver` sobre el DOM de
  Connecteam) detecta mensajes nuevos gratis. La IA solo se llama una vez por mensaje
  nuevo, nunca en bucle.
- **Selectores DOM estables**: se usan clases semánticas (`chat-message`, `user-name-container`,
  `text-bubble`, `reply-message-module__text`, etc.), NO las clases hasheadas tipo
  `go29332765461` que aparecen en elementos decorativos (avatares). Estas últimas cambian
  en cada deploy de Connecteam y no deben usarse como selectores.
- **Backend intermedio obligatorio**: ninguna API key (ni de LLM ni de GitHub) vive en el
  navegador. Todo pasa por un Cloudflare Worker que guarda los secrets del lado del servidor.
- **Proveedor de IA intercambiable**: el Worker tiene una función `callLLM()` que despacha
  a `callOpenAICompatible` (sirve para DeepSeek y OpenAI) o `callAnthropic` según el secret
  `LLM_PROVIDER`. Nunca hardcodear un proveedor específico fuera de esa función.
- **Fuente de verdad = repo de GitHub**, no una base de datos ni un documento de Claude.
  El Worker la lee en vivo en cada interpretación (carpeta `docs/business-logic/*.md`).
- **Formato de cada módulo de conocimiento** (ver `_TEMPLATE.md`): Qué hace / Condiciones /
  Excepciones / **Nivel de autonomía permitido a la IA** (puede responder sola / con aviso /
  siempre debe escalar) / **Errores comunes de quien recién empieza** / Casos reales.
  Las dos secciones en negrita son las más importantes: capturan el juicio experto de Juan,
  no solo hechos.
- **UI de edición de reglas**: página HTML standalone (no un artifact publicado — los
  artifacts publicados de Claude no permiten fetch a dominios externos arbitrarios, así
  que esto se abre como archivo local o se hostea donde Juan quiera). Llama al mismo
  Worker con `action: "save_rule"` y hace commit real a GitHub vía la API de contenidos.

## Estado actual / qué falta

- [ ] Repo de GitHub creado con la estructura de `kb/` (README, docs/business-logic/,
      docs/fts/CHANGELOG.md, docs/glosario.md, `_TEMPLATE.md`).
- [ ] Worker desplegado en Cloudflare con los secrets: `LLM_PROVIDER`, `LLM_API_KEY`,
      `SHARED_SECRET`, `GITHUB_TOKEN` (fine-grained PAT, permiso Contents read/write,
      limitado solo a ese repo).
- [ ] Constantes `GITHUB_OWNER` / `GITHUB_REPO` del Worker actualizadas con los datos reales.
- [ ] Userscript de Tampermonkey instalado, con `BACKEND_URL` y `SHARED_SECRET` apuntando
      al Worker real.
- [ ] `rule-editor.html` con `WORKER_URL` y `SHARED_SECRET` configurados.
- [ ] Base de conocimiento real llenada (hoy solo hay un ejemplo de "membresías" a medio
      llenar). Este es el trabajo recurrente, no una tarea de configuración de una sola vez.

## Archivos que ya existen (pídelos a Claude en la conversación de origen si no los tienes,
## o pide que te los regenere con estas mismas especificaciones)

- `worker-v3.js` — Cloudflare Worker con 4 acciones: `interpret`, `list_rules`, `get_rule`,
  `save_rule`. Este es el que hay que usar (reemplaza a `worker.js` y
  `worker-v2-multiprovider.js`, que son versiones anteriores incompletas).
- `connecteam-listener-v2.user.js` — userscript que detecta mensajes y llama al Worker
  para interpretar (acción `interpret`).
- `rule-editor.html` — UI standalone para crear/editar módulos de la base de conocimiento.
- `kb/` — estructura del repo de conocimiento (README.md, docs/business-logic/_TEMPLATE.md,
  docs/business-logic/membresias.md de ejemplo, docs/fts/CHANGELOG.md, docs/glosario.md).

## Lo que NO se debe hacer (restricciones deliberadas, no olvidos)

- No conectar Jira a este flujo — Juan lo descartó explícitamente, esto es solo
  detectar → interpretar → responder, sin gestión de tickets.
- No automatizar el envío del mensaje sin revisión humana.
- No poner ninguna API key en código que corra en el navegador (userscript o HTML) —
  siempre a través del Worker.
- No depender de nombres de clase CSS hasheados/generados en los selectores del listener.

## Próximo paso sugerido si retomas esto en Claude Code

Pide que te ayude a:
1. Inicializar el repo local con la estructura de `kb/` y conectarlo al remoto de GitHub.
2. Colocar `worker-v3.js` listo para desplegar con Wrangler (CLI de Cloudflare), incluyendo
   un `wrangler.toml` básico.
3. Verificar que `connecteam-listener-v2.user.js` y `rule-editor.html` apunten a la URL
   real del Worker una vez desplegado.
