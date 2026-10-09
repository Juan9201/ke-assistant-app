// ==UserScript==
// @name         KE Assistant — Connecteam listener v2
// @namespace    https://github.com/Juan9201/ke-assistant
// @version      2.6.0
// @description  Detecta mensajes nuevos en Gravity Support y sugiere una respuesta. Solo envía si tú haces clic en "Enviar".
// @match        https://app.connecteam.com/*
// @grant        GM_xmlhttpRequest
// @updateURL    http://127.0.0.1:8787/userscript/connecteam-listener-v2.user.js
// @downloadURL  http://127.0.0.1:8787/userscript/connecteam-listener-v2.user.js
// @connect      localhost
// @connect      127.0.0.1
// @connect      connecteam.com
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==
//
// Si usas un dominio propio para el Worker, agrega otra línea `// @connect tu-dominio.com`.

(function () {
  "use strict";

  /* ================================================================ */
  /* CONFIGURACIÓN — reemplaza los placeholders                        */
  /* ================================================================ */
  const CONFIG = {
    // Backend: por defecto el server local (local-server/), sin barra final.
    // Si en vez de eso usas el Worker de Cloudflare, pon aquí la URL que imprime
    // `npm run deploy` (algo como https://ke-assistant.tu-subdominio.workers.dev).
    BACKEND_URL: "http://localhost:8787",
    // El servidor local reemplaza __SHARED_SECRET__ por el SHARED_SECRET de local-server/.env al entregar este archivo:
    // instálalo desde http://127.0.0.1:8787/userscript/connecteam-listener-v2.user.js (no lo copies a mano).
    SHARED_SECRET: "__SHARED_SECRET__",
    // Nombres del equipo interno de soporte (Foxihost), tal como aparecen en el
    // chat. Sus mensajes en Gravity Support NUNCA se interpretan (ni se llama a
    // la IA) porque el equipo se coordina entre sí por Slack, no por este chat.
    IGNORE_AUTHORS: [
      "Juan Garcia",
      "Silvia Hernandez",
      "Jorge Lira",
      "Manuel Ruiz",
      "Yeison Berrio",
      "Andre Ho",
      "James Tully",
      "Pierre Goriel",
      "Samuel Carrillo",
    ],
    // Nombre del canal (se lee del header de Connecteam) al que debe limitarse
    // el listener. "" = actuar en cualquier chat abierto.
    CHANNEL_NAME_FRAGMENT: "Gravity Support",
    // Opcional: además del nombre, restringe también por URL si hace falta.
    // "" = no filtrar por URL.
    CHANNEL_URL_FRAGMENT: "",
    // Si el cuadro de texto está vacío, pega la sugerencia automáticamente (sin enviarla).
    AUTO_INSERT_WHEN_EMPTY: true,
    // Selectores del cuadro de texto, en orden de preferencia. Verifícalos con DevTools
    // (clic derecho sobre el cuadro → Inspeccionar). Evita clases hasheadas tipo go123456.
    COMPOSER_SELECTORS: [
      '[contenteditable="true"][role="textbox"]',
      '.chat-input [contenteditable="true"]',
      '[placeholder*="write something" i]',
      '[data-placeholder*="write something" i]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="mensaje" i]',
    ],
    // Selectores del botón "Enviar" de Connecteam. SUPOSICIONES sin verificar
    // contra el DOM real — inspecciona el botón de enviar con DevTools antes
    // de confiar en el botón "Enviar" del panel. Se busca SOLO cerca del
    // cuadro de texto (nunca en toda la página) para no hacer clic por error
    // en un botón no relacionado.
    SEND_BUTTON_SELECTORS: [
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
      'button[type="submit"]',
    ],
    // Si Connecteam permite responder directamente a un mensaje ("Reply"), el
    // asistente lo activa ANTES de insertar el texto, para que la respuesta
    // quede citando el mensaje original en vez de aparecer como un mensaje
    // suelto dirigido a todo el canal. Ponlo en false si te da problemas.
    USE_NATIVE_REPLY: true,
    DEBUG: false,
  };

  // Selectores semánticos de Connecteam. La extracción de texto, `.me` y el
  // título del canal vienen confirmados contra el DOM real (verificados con un
  // listener de solo lectura ya en producción); el resto sigue el patrón
  // documentado en el brief. Evita clases hasheadas tipo go29332765461.
  const SEL = {
    messageWrapper: "[data-message-id]", // envuelve a .chat-message, trae el id real
    message: ".chat-message",
    author: ".user-name-container",
    textWrapper: ".hour-and-caption-container", // envuelve la hora + la burbuja de texto
    text: ".text-bubble",
    markdown: ".markdown-content-module__markdownContainer",
    plainSpan: 'span[dir="auto"]',
    replyQuote: ".reply-message-module__text",
    channelTitle: '.conversation-description-card-module__titleContainer span, [data-testid="text"]',
    // Botón "Reply" de un mensaje específico. Confirmado por Juan con DevTools
    // contra el DOM real de Connecteam.
    replyButton: '[data-testid="automation-reply-message-option"]',
    // Fotos adjuntas de un mensaje (confirmado con DevTools: .image-gallery-message img.attachment-img).
    attachmentImg: ".image-gallery-message img.attachment-img, img.attachment-img",
  };

  // Versión del "contrato" con el servidor local (forma de la respuesta de analyze_flames).
  // Si no coincide con la del servidor, el panel avisa en vez de fallar con un error críptico.
  const SCRIPT_VERSION = "2.6.0";
  const EXPECTED_CONTRACT = 2;

  const QUIET_MS = 2500; // tiempo sin cambios para considerar que el historial terminó de cargar
  const MAX_ARM_WAIT_MS = 10000; // tope por si el DOM nunca queda quieto
  const BULK_THRESHOLD = 3; // más mensajes que esto en un lote = carga de historial, no mensaje nuevo
  const TAIL_WINDOW = 3; // solo se interpretan mensajes entre los últimos N del DOM
  // Barrido de respaldo: las listas virtualizadas (Connecteam usa una) a veces
  // reciclan nodos sin disparar `childList`. Sin esto, un mensaje nuevo podría
  // no detectarse hasta el siguiente cambio real del DOM.
  const RESCAN_INTERVAL_MS = 4000;
  const SEEN_TTL_MS = 6 * 60 * 60 * 1000;
  const SEEN_STORAGE_KEY = "ke-assistant-seen";

  const log = (...a) => CONFIG.DEBUG && console.log("[KE]", ...a);

  /* ================================================================ */
  /* Estado                                                            */
  /* ================================================================ */
  let armed = false; // false mientras se carga el historial de una conversación
  let paused = false;
  let quietTimer = null;
  let armDeadline = 0;
  let lastUrl = location.href;
  const queue = [];
  let busy = false;
  const seen = loadSeen();

  function loadSeen() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SEEN_STORAGE_KEY) || "{}");
      const now = Date.now();
      return new Map(Object.entries(raw).filter(([, t]) => now - t < SEEN_TTL_MS));
    } catch {
      return new Map();
    }
  }

  function saveSeen() {
    try {
      sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Object.fromEntries(seen)));
    } catch {
      /* sin storage: la deduplicación sigue funcionando en memoria */
    }
  }

  /* ================================================================ */
  /* Extracción de datos del DOM                                        */
  /* ================================================================ */
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  /** Cascada de extracción de texto: mensaje enriquecido, texto plano, o el resto tal cual. */
  function extractText(chatMsgEl) {
    const bubble = chatMsgEl.querySelector(`${SEL.textWrapper} ${SEL.text}`) || chatMsgEl.querySelector(SEL.text);
    if (!bubble) return "";

    const clone = bubble.cloneNode(true);
    clone.querySelectorAll(SEL.replyQuote).forEach((q) => q.remove());

    const markdown = clone.querySelector(SEL.markdown);
    if (markdown) return norm(markdown.innerText);

    const plain = clone.querySelector(SEL.plainSpan);
    if (plain) return norm(plain.textContent);

    return norm(clone.innerText);
  }

  /** Id real y estable del mensaje (vive en el wrapper que lo envuelve, no en .chat-message). */
  function getMessageId(el) {
    const wrapper = el.closest(SEL.messageWrapper);
    return wrapper?.getAttribute("data-message-id") || el.getAttribute("data-id") || el.id || "";
  }

  function extractImages(el) {
    return Array.from(el.querySelectorAll(SEL.attachmentImg))
      .map((i) => i.currentSrc || i.src)
      .filter(Boolean);
  }

  function extract(el) {
    const text = extractText(el);
    const images = extractImages(el);
    if (!text && !images.length) return null;

    const quoteEl = el.querySelector(SEL.replyQuote);
    const replyTo = quoteEl ? norm(quoteEl.innerText) : "";

    // Connecteam NO muestra .user-name-container en tus propios mensajes; en su
    // lugar marca el mensaje con la clase "me". Es más confiable que comparar
    // nombres, así que se usa para saltar tus mensajes con certeza (sin
    // necesidad de que IGNORE_AUTHORS coincida exacto con tu nombre mostrado).
    const isMe = el.classList.contains("me");

    return { id: getMessageId(el), isMe, author: isMe ? "" : findAuthor(el), text, replyTo, images };
  }

  /** Los mensajes consecutivos del mismo autor no repiten el nombre: se busca hacia atrás. */
  function findAuthor(el) {
    const all = Array.from(document.querySelectorAll(SEL.message));
    for (let i = all.indexOf(el); i >= 0; i--) {
      const nameEl = all[i].querySelector(SEL.author);
      if (nameEl && norm(nameEl.innerText)) return norm(nameEl.innerText);
    }
    return "";
  }

  // Normaliza acentos (p. ej. "García" === "Garcia") para que no dependa de
  // escribir la tilde exacta en IGNORE_AUTHORS.
  const foldName = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  function isInternalTeam(author) {
    const a = foldName(author);
    return CONFIG.IGNORE_AUTHORS.some((n) => n && a === foldName(n));
  }

  // Hash corto del contenido: dos mensajes distintos nunca comparten llave aunque Connecteam repita el id (se vio en casos reales).
  function shortHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const contentHash = (data) => shortHash(`${data.author}|${data.replyTo}|${data.text}|${(data.images || []).length}`);

  function messageKey(el, data) {
    return data.id ? `id:${data.id}|${contentHash(data)}` : `tx:${data.author}|${data.replyTo}|${data.text}`;
  }

  function getChannelName() {
    const header = document.querySelector(SEL.channelTitle);
    return header ? norm(header.textContent) : "";
  }

  function isTargetChannel() {
    const nameOk = !CONFIG.CHANNEL_NAME_FRAGMENT
      || getChannelName().toLowerCase().includes(CONFIG.CHANNEL_NAME_FRAGMENT.toLowerCase());
    const urlOk = !CONFIG.CHANNEL_URL_FRAGMENT || location.href.includes(CONFIG.CHANNEL_URL_FRAGMENT);
    return nameOk && urlOk;
  }

  /* ================================================================ */
  /* Detección de mensajes nuevos (sin IA)                              */
  /* ================================================================ */
  function markAllSeen() {
    document.querySelectorAll(SEL.message).forEach((el) => {
      const data = extract(el);
      if (data) seen.set(messageKey(el, data), Date.now());
    });
    saveSeen();
  }

  /** Espera a que el DOM quede quieto; todo lo que haya en ese momento es historial. */
  function scheduleArm() {
    armed = false;
    if (!armDeadline) armDeadline = Date.now() + MAX_ARM_WAIT_MS;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      markAllSeen();
      armed = true;
      armDeadline = 0;
      setStatus(paused ? "paused" : "listening");
      log("armado");
    }, Math.max(0, Math.min(QUIET_MS, armDeadline - Date.now())));
  }

  function collectAddedMessages(mutations) {
    const found = new Set();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1 || panelHost.contains(node)) continue;
        if (node.matches(SEL.message)) found.add(node);
        node.querySelectorAll?.(SEL.message).forEach((el) => found.add(el));
        const parentMsg = node.closest?.(SEL.message);
        if (parentMsg) found.add(parentMsg); // el contenido de la burbuja llegó después
      }
    }
    return Array.from(found);
  }

  /**
   * Evalúa solo los últimos TAIL_WINDOW mensajes visibles (mensajes viejos que
   * reaparecen por scroll/virtualización nunca llegan aquí). Se llama tanto
   * desde las mutaciones reales como desde el barrido periódico de respaldo,
   * así que es segura de invocar tantas veces como haga falta: `seen` evita
   * procesar dos veces el mismo mensaje.
   */
  function evaluateTail() {
    if (paused || !isTargetChannel()) return;

    const all = Array.from(document.querySelectorAll(SEL.message));
    const tail = all.slice(-TAIL_WINDOW);

    for (const el of tail) {
      const data = extract(el);
      if (!data) continue;
      const key = messageKey(el, data);
      if (seen.has(key)) continue;
      seen.set(key, Date.now());
      saveSeen();

      if (data.isMe || isInternalTeam(data.author)) continue;

      log("mensaje nuevo", data);
      queue.push(data);
    }
    processQueue();
  }

  function onMutations(mutations) {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log("cambio de conversación");
      scheduleArm();
      return;
    }
    if (!armed) {
      scheduleArm(); // sigue cargando historial
      return;
    }

    const added = collectAddedMessages(mutations);
    if (!added.length) return;

    if (added.length > BULK_THRESHOLD) {
      log("lote grande, se trata como historial", added.length);
      markAllSeen();
      return;
    }

    evaluateTail();
  }

  /* ================================================================ */
  /* Llamada al Worker (una por mensaje nuevo)                          */
  /* ================================================================ */
  function interpret(data) {
    return callBackend({
      action: "interpret",
      message: data.text,
      author: data.author,
      replyTo: data.replyTo,
    });
  }

  function callBackend(payload, timeoutMs = 35000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.BACKEND_URL,
        headers: { "Content-Type": "application/json", "X-Shared-Secret": CONFIG.SHARED_SECRET },
        data: JSON.stringify(payload),
        timeout: timeoutMs,
        onload: (res) => {
          let body = null;
          try {
            body = JSON.parse(res.responseText);
          } catch {
            /* se reporta abajo */
          }
          if (res.status >= 200 && res.status < 300 && body) resolve(body);
          else reject(new Error((body && body.error) || `HTTP ${res.status}`));
        },
        onerror: () => reject(new Error("No se pudo contactar al Worker")),
        ontimeout: () => reject(new Error("El Worker tardó demasiado")),
      });
    });
  }

  async function processQueue() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const data = queue.shift();
      setStatus("working");
      try {
        // Texto y foto del mismo autor, cerca en el tiempo, son UN solo pedido (spec 003, R-02).
        if (!data.forceNew) {
          const who = foldName(data.author || "");
          const now = Date.now();
          if (!data.text && data.images?.length) {
            const open = openCards.get(who);
            if (open && now - open.ts < MERGE_WINDOW_MS && open.card.isConnected !== false) {
              open.card.addImages(data.images); // la foto llegó después del texto: se agrega a su tarjeta
            } else {
              pendingPhotos.set(who, { images: data.images, ts: now }); // la foto llegó primero: espera su texto
            }
            continue;
          }
          const pend = pendingPhotos.get(who);
          if (pend && now - pend.ts < MERGE_WINDOW_MS) {
            data.images = [...pend.images, ...(data.images || [])];
            pendingPhotos.delete(who);
          }
        }
        // Spec 002: primero se analiza sin IA; si es un pedido de flames se muestra
        // la tarjeta de aprobación y NO se llama al modelo.
        let analysis;
        try {
          data.caseId = data.caseId || (data.id ? `msg-${data.id}-${contentHash(data)}` : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
          analysis = await callBackend({ action: "analyze_flames", caseId: data.caseId, messageKey: messageKey(null, data), messageId: data.id, images: data.images || [], channel: getChannelName(), text: data.text, author: data.author });
          if (analysis.ticket && analysis.ticket.caseId) data.caseId = analysis.ticket.caseId; // varios mensajes del mismo staff comparten ticket
        } catch (e) {
          throw new Error(`${e.message} (¿reiniciaste el servidor local tras actualizar?)`);
        }
        if (analysis.contract !== EXPECTED_CONTRACT) {
          throw new Error(
            `El servidor local y el userscript (v${SCRIPT_VERSION}) no son de la misma versión: reinicia el servidor y actualiza el userscript en Tampermonkey.`,
          );
        }
        if (analysis.isFlameRequest) {
          await ensureParks();
          const flameCard = addFlameCard(data, analysis);
          if (!data.forceNew) openCards.set(foldName(data.author || ""), { card: flameCard, ts: Date.now() });
          if (data.images?.length) flameCard.addImages(data.images);
          if (CONFIG.AUTO_INSERT_WHEN_EMPTY && analysis.reply) {
            const composer = findComposer();
            if (composer && composerIsEmpty(composer)) {
              insertReplyToOriginal(data, analysis.reply, (ok) => ok && flameCard.markQuestionInserted());
            }
          }
          continue;
        }
        const result = await interpret(data);
        const card = addCard(data, result);
        if (CONFIG.AUTO_INSERT_WHEN_EMPTY) {
          const composer = findComposer();
          if (composer && composerIsEmpty(composer)) {
            insertReplyToOriginal(data, result.reply, (ok) => ok && card.markInserted());
          }
        }
      } catch (err) {
        addErrorCard(data, err.message);
      }
    }
    busy = false;
    setStatus(paused ? "paused" : "listening");
  }

  /* ================================================================ */
  /* Cuadro de texto de Connecteam — insertar es automático; enviar solo   */
  /* ocurre si tú haces clic en "Enviar" y confirmas (ver findSendButton).  */
  /* ================================================================ */
  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findComposer() {
    for (const s of CONFIG.COMPOSER_SELECTORS) {
      const el = Array.from(document.querySelectorAll(s)).find(
        (e) => isVisible(e) && !panelHost.contains(e),
      );
      if (el) return el;
    }
    return null;
  }

  function composerIsEmpty(el) {
    return norm(el.isContentEditable ? el.innerText : el.value) === "";
  }

  /**
   * Busca el botón de enviar SOLO dentro de un contenedor cercano al cuadro de
   * texto — nunca en toda la página — para minimizar el riesgo de hacer clic
   * en un botón no relacionado que por casualidad coincida con el selector.
   */
  function findSendButton(composer) {
    const scope =
      composer.closest(".chat-input, form, [class*='composer' i], [class*='message-input' i]") ||
      composer.parentElement?.parentElement ||
      composer.parentElement ||
      composer;
    for (const s of CONFIG.SEND_BUTTON_SELECTORS) {
      const el = Array.from(scope.querySelectorAll(s)).find((e) => isVisible(e) && !panelHost.contains(e));
      if (el) return el;
    }
    return null;
  }

  /** Vacía el cuadro de texto (para reemplazar una sugerencia automática por la respuesta de la consola). */
  function clearComposer(el) {
    el.focus();
    if (el.isContentEditable) {
      document.execCommand("selectAll", false, null);
      if (!document.execCommand("delete", false, null)) el.textContent = "";
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      setter.call(el, "");
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  function insertIntoComposer(el, text) {
    el.focus();
    if (el.isContentEditable) {
      // execCommand respeta el estado interno de editores React/Draft/Slate.
      if (!composerIsEmpty(el)) document.execCommand("insertText", false, " ");
      if (!document.execCommand("insertText", false, text)) {
        el.textContent += text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      setter.call(el, composerIsEmpty(el) ? text : `${el.value} ${text}`);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /**
   * Activa el "Reply" nativo de Connecteam sobre el mensaje exacto (por su id
   * estable, no por una referencia de nodo que puede haberse reciclado por la
   * lista virtualizada). Busca el botón SOLO dentro de ese mensaje, nunca en
   * toda la página. Confirmado contra el DOM real: el botón ya existe en el
   * DOM (solo oculto por CSS hasta el hover), así que un .click() directo
   * basta — no hace falta simular el hover.
   */
  function clickReply(id) {
    if (!id) return false;
    const wrapper = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!wrapper) return false; // el mensaje salió del rango virtualizado
    const btn = wrapper.querySelector(SEL.replyButton);
    if (!btn) return false;
    btn.click();
    return true;
  }

  /**
   * Rastreo de "texto pendiente nuestro": mientras el cuadro contenga EXACTO
   * lo último que insertamos (sin que Juan lo haya editado), un Enter se
   * intercepta y se redirige al mismo flujo con confirmación de "Enviar" —
   * ver el guardián de teclado más abajo. En cuanto el contenido cambia
   * (Juan lo edita o escribe algo propio), deja de aplicar y Enter vuelve a
   * comportarse nativo, como cualquier mensaje suyo normal.
   */
  let pendingAiText = "";
  let pendingAiComposer = null;

  /**
   * Inserta el texto citando el mensaje original cuando es posible. Si el
   * mensaje ya no está en el DOM (virtualización) o el botón Reply no
   * apareció, degrada sin error a una inserción normal — nunca bloquea el
   * flujo por esto.
   */
  function insertReplyToOriginal(data, text, done) {
    let quoted = false;
    const finish = () => {
      const composer = findComposer();
      if (!composer) return done(false);
      insertIntoComposer(composer, text);
      // Se lee el contenido REAL después de insertar (no el "text" original):
      // si el cuadro ya tenía algo, insertIntoComposer concatena, y comparar
      // contra el texto original desarmaría el guardián de Enter por error.
      pendingAiText = norm(composer.isContentEditable ? composer.innerText : composer.value);
      pendingAiComposer = composer;
      done(true, quoted);
    };
    if (CONFIG.USE_NATIVE_REPLY && (quoted = clickReply(data.id))) {
      setTimeout(finish, 200); // deja que Connecteam actualice el composer con la cita
    } else {
      finish();
    }
  }

  /**
   * Punto único de envío: confirmación nativa + clic en el botón real de
   * Connecteam. Lo usan tanto el botón "Enviar" de cada tarjeta como el
   * guardián de Enter (ver abajo) — nunca se llega aquí sin que algo
   * (un clic o un Enter sobre una sugerencia sin editar) lo dispare.
   * Devuelve: "sent" | "cancelled" | "no-composer" | "empty" | "no-send-button".
   */
  function confirmAndSend(opts = {}) {
    const composer = findComposer();
    if (!composer) return "no-composer";

    const current = norm(composer.isContentEditable ? composer.innerText : composer.value);
    if (!current) return "empty";

    // Un envío pedido desde la consola: solo si el cuadro tiene EXACTAMENTE lo que se insertó (si no, no se envía).
    if (opts.expectedText && norm(opts.expectedText) !== current) return "changed";

    const channel = getChannelName() || "este chat";
    if (!opts.skipConfirm && !confirm(`¿Enviar este mensaje a "${channel}"?\n\n"${current}"`)) return "cancelled";

    const sendButton = findSendButton(composer);
    if (!sendButton) return "no-send-button";

    sendButton.click();
    pendingAiText = "";
    pendingAiComposer = null;
    return "sent";
  }

  /**
   * Guardián de Enter: si el cuadro contiene EXACTO una sugerencia nuestra sin
   * editar, intercepta Enter y lo redirige a confirmAndSend() en vez de dejar
   * que Connecteam envíe directo. Así el botón "Enviar" no es la única
   * protección — presionar Enter por reflejo nunca salta la confirmación.
   * Si Juan edita el texto (o escribe el suyo propio), esto deja de aplicar
   * automáticamente y Enter vuelve a su comportamiento nativo.
   */
  function installEnterGuard() {
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Enter" || e.shiftKey || !pendingAiComposer) return;
        if (document.activeElement !== pendingAiComposer) return;
        const current = norm(
          pendingAiComposer.isContentEditable ? pendingAiComposer.innerText : pendingAiComposer.value,
        );
        if (current !== pendingAiText) {
          // Juan ya lo editó: se trata como su propio mensaje, Enter nativo.
          pendingAiText = "";
          pendingAiComposer = null;
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        confirmAndSend();
      },
      true, // capture: se adelanta al manejador nativo de Connecteam
    );

    // Si Juan edita el texto insertado, deja de tratarse como "sugerencia sin
    // confirmar" y Enter vuelve a enviar nativo, como cualquier mensaje suyo.
    document.addEventListener(
      "input",
      (e) => {
        if (e.target !== pendingAiComposer) return;
        const current = norm(
          pendingAiComposer.isContentEditable ? pendingAiComposer.innerText : pendingAiComposer.value,
        );
        if (current !== pendingAiText) {
          pendingAiText = "";
          pendingAiComposer = null;
        }
      },
      true,
    );
  }

  /* ================================================================ */
  /* Panel flotante (shadow DOM para no chocar con los estilos del sitio) */
  /* ================================================================ */
  const panelHost = document.createElement("div");
  panelHost.id = "ke-assistant-panel";
  const shadow = panelHost.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: fixed; right: 16px; bottom: 16px; width: 440px; max-height: 85vh;
        display: flex; flex-direction: column; z-index: 2147483647;
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328;
        background: #fff; border: 1px solid #d0d7de; border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,.15); }
      .wrap.min .body { display: none; }
      header { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        border-bottom: 1px solid #d0d7de; cursor: default; }
      header strong { flex: 1; white-space: nowrap; }
      header button { white-space: nowrap; padding: 3px 6px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #8c959f; }
      .dot.listening { background: #1a7f37; }
      .dot.working { background: #bf8700; }
      .dot.paused { background: #8c959f; }
      .dot.error { background: #cf222e; }
      button { font: inherit; border: 1px solid #d0d7de; background: #f6f8fa; border-radius: 6px;
        padding: 3px 8px; cursor: pointer; color: inherit; }
      button:hover { background: #eaeef2; }
      button.primary { background: #1f6feb; color: #fff; border-color: #1f6feb; }
      button.danger { background: #cf222e; color: #fff; border-color: #cf222e; }
      button:disabled { opacity: .5; cursor: not-allowed; }
      .body { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
      .empty { color: #656d76; text-align: center; padding: 12px; }
      .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 8px; }
      .card.warn { border-color: #bf8700; background: #fff8c5; }
      .card.fallback { border-color: #d0d7de; background: #f6f8fa; }
      .card.err { border-color: #cf222e; background: #ffebe9; }
      .meta { color: #656d76; font-size: 12px; margin-bottom: 4px; }
      .orig { font-style: italic; margin-bottom: 6px; max-height: 4.2em; overflow: hidden; }
      textarea { width: 100%; box-sizing: border-box; min-height: 60px; font: inherit;
        border: 1px solid #d0d7de; border-radius: 6px; padding: 6px; resize: vertical; }
      .badges { display: flex; flex-wrap: wrap; gap: 4px; margin: 4px 0; }
      .badge { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #ddf4ff; }
      .badge.aviso { background: #fff1a8; }
      .badge.escalar { background: #eaeef2; }
      .badge.case { background: #e6d9ff; }
      .actions { display: flex; gap: 6px; margin-top: 6px; }
      details { margin-top: 6px; font-size: 12px; color: #656d76; }
      .card.flames { border-color: #1f6feb; }
      .sec { font-weight: 600; margin: 8px 0 2px; }
      .understood { background: #ddf4ff; border-radius: 6px; padding: 6px; }
      .fields { display: grid; grid-template-columns: 64px 1fr; gap: 4px 8px; align-items: center; }
      .fields input, .fields select { box-sizing: border-box; width: 100%; font: inherit; padding: 3px 6px;
        border: 1px solid #d0d7de; border-radius: 6px; background: #fff; }
      .fields input.bad, .fields select.bad { border-color: #cf222e; background: #ffebe9; }
      .blockers { margin: 6px 0 0; padding-left: 18px; color: #cf222e; }
      .steps { margin: 2px 0 0; padding-left: 20px; }
      .evidence { margin-top: 6px; }
      .ev-list { list-style: none; margin: 4px 0; padding: 0; font-size: 12px; }
      .ev-list li { padding: 1px 0; }
      .ev-ok { color: #1a7f37; } .ev-fail { color: #cf222e; font-weight: 600; } .ev-warn { color: #9a6700; }
      .verdict { margin-top: 4px; padding: 6px; border-radius: 6px; font-weight: 600; }
      .verdict-A { background: #dafbe1; color: #116329; } .verdict-B { background: #fff1a8; color: #7d4e00; } .verdict-escalate { background: #ffebe9; color: #a40e26; }
      .warns { margin: 6px 0 0; padding-left: 18px; color: #9a6700; list-style: none; }
      .pending { margin: 6px 0 0; padding-left: 18px; color: #656d76; list-style: none; }
      .vision .photo { margin: 6px 0; }
      .vcanvas { width: 100%; display: block; border: 1px solid #d0d7de; border-radius: 6px; margin: 4px 0; }
      .finds { margin: 4px 0 0; padding: 0; list-style: none; font-size: 12px; }
      .finds li { display: flex; gap: 6px; align-items: center; padding: 1px 0; cursor: pointer; }
      .finds li span:nth-child(2) { flex: 1; }
      .dot2 { width: 10px; height: 10px; border-radius: 2px; flex: none; }
      .low { color: #bf8700; font-weight: 600; }
      .nf { color: #cf222e; font-size: 12px; margin-top: 4px; }
      button.go { background: #1a7f37; color: #fff; border-color: #1a7f37; font-weight: 600; padding: 5px 12px; }
      button.go:hover { background: #116329; }
    </style>
    <div class="wrap">
      <header>
        <span class="dot" id="dot"></span>
        <strong>KE Assistant <small style="font-weight:400;color:#656d76">v${SCRIPT_VERSION}</small></strong>
        <button id="testInsert" title="Pega un texto de prueba en el cuadro, sin enviarlo">Probar cuadro</button>
        <button id="testPhoto" title="Lee la última foto del chat y muestra lo que ve el asistente (sin enviar nada)">Probar foto</button>
        <button id="pause" title="Pausar / reanudar">Pausar</button>
        <button id="min" title="Minimizar">–</button>
      </header>
      <div class="body" id="body"><div class="empty">Escuchando mensajes nuevos…</div></div>
    </div>`;

  const $ = (id) => shadow.getElementById(id);
  const cardsEl = $("body");

  $("pause").addEventListener("click", () => {
    paused = !paused;
    $("pause").textContent = paused ? "Reanudar" : "Pausar";
    setStatus(paused ? "paused" : "listening");
  });
  $("min").addEventListener("click", () => shadow.querySelector(".wrap").classList.toggle("min"));

  // Prueba aislada de inserción: no depende del backend ni de GitHub. Sirve
  // para verificar COMPOSER_SELECTORS contra el DOM real antes de que el resto
  // del pipeline esté listo. Nunca presiona Enter ni hace clic en enviar.
  $("testInsert").addEventListener("click", () => {
    const composer = findComposer();
    if (!composer) {
      $("testInsert").textContent = "No encontré el cuadro";
      setTimeout(() => ($("testInsert").textContent = "Probar cuadro"), 2500);
      return;
    }
    const testText = "Prueba de KE Assistant — puedes borrar este texto.";
    insertIntoComposer(composer, testText);
    pendingAiText = norm(composer.isContentEditable ? composer.innerText : composer.value);
    pendingAiComposer = composer;
    $("testInsert").textContent = "Insertado ✓";
    setTimeout(() => ($("testInsert").textContent = "Probar cuadro"), 2500);
  });

  // Prueba aislada de lectura: toma la última foto visible del chat (aunque el mensaje no sea nuevo) y muestra
  // lo que lee el asistente. No envía nada ni toca el cuadro de texto.
  $("testPhoto").addEventListener("click", () => {
    const withPhoto = Array.from(document.querySelectorAll(SEL.message)).filter((m) => m.querySelector(SEL.attachmentImg));
    const last = withPhoto[withPhoto.length - 1];
    const btn = $("testPhoto");
    if (!last) {
      btn.textContent = "No hay fotos aquí";
      setTimeout(() => (btn.textContent = "Probar foto"), 2500);
      return;
    }
    const d = extract(last);
    queue.push({ ...d, text: d.text || "play card flames (prueba de foto)", caseId: `prueba-foto-${Date.now()}`, forceNew: true });
    processQueue();
  });

  function setStatus(state) {
    $("dot").className = `dot ${state}`;
    $("dot").title = state;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    children.forEach((c) => node.append(c));
    return node;
  }

  function pushCard(card) {
    cardsEl.querySelector(".empty")?.remove();
    cardsEl.prepend(card);
    while (cardsEl.children.length > 6) cardsEl.lastElementChild.remove();
  }

  function addCard(data, result) {
    const kind = !result.supported ? "fallback" : result.needsReview ? "warn" : "";
    const textarea = el("textarea", { value: result.reply });

    const badges = el("div", { className: "badges" });
    if (result.caseCategory) {
      const label = `${result.caseIsNew ? "caso nuevo" : "continúa"}: ${result.caseCategory}`;
      badges.append(el("span", { className: "badge case", textContent: label, title: result.caseId || "" }));
    }
    if (result.module) badges.append(el("span", { className: "badge", textContent: result.module }));
    if (result.autonomy) {
      const cls = result.autonomy.includes("escalar") ? "escalar" : result.autonomy.includes("aviso") ? "aviso" : "";
      badges.append(el("span", { className: `badge ${cls}`, textContent: result.autonomy }));
    }

    const insertBtn = el("button", { className: "primary", textContent: "Insertar" });
    const copyBtn = el("button", { textContent: "Copiar" });
    const dismissBtn = el("button", { textContent: "Descartar" });
    // Deshabilitado hasta que el texto quede insertado en el cuadro real —
    // así nunca se puede enviar algo que no pasó por "Insertar" primero.
    const sendBtn = el("button", {
      className: "danger",
      textContent: "Enviar",
      disabled: true,
      title: "Primero inserta el texto en el cuadro",
    });

    const card = el("div", { className: `card ${kind}` }, [
      el("div", { className: "meta", textContent: `${data.author || "Desconocido"} · ${new Date().toLocaleTimeString()}` }),
      el("div", { className: "orig", textContent: `“${data.text}”` }),
      badges,
      textarea,
      el("div", { className: "actions" }, [insertBtn, copyBtn, sendBtn, dismissBtn]),
    ]);

    if (result.reason || result.draft) {
      const details = el("details", {}, [el("summary", { textContent: "Por qué" })]);
      if (result.reason) details.append(el("div", { textContent: result.reason }));
      if (result.draft) {
        details.append(el("div", { textContent: "Borrador interno (NO insertado):" }));
        details.append(el("div", { textContent: result.draft }));
      }
      card.append(details);
    }

    insertBtn.addEventListener("click", () => {
      insertReplyToOriginal(data, textarea.value, (ok) => {
        if (!ok) {
          insertBtn.textContent = "No encontré el cuadro";
          return;
        }
        card.markInserted();
      });
    });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(textarea.value);
      copyBtn.textContent = "Copiado";
    });
    dismissBtn.addEventListener("click", () => card.remove());

    // Un solo clic tuyo para enviar: encuentra el botón real de Connecteam y
    // lo presiona. Requiere confirmación nativa y que el texto ya se haya
    // insertado (sendBtn empieza deshabilitado) — nunca se dispara solo.
    sendBtn.addEventListener("click", () => {
      const ok = confirmAndSend();
      if (ok === "sent") {
        sendBtn.textContent = "Enviado ✓";
        sendBtn.disabled = true;
      } else if (ok === "no-composer") {
        sendBtn.textContent = "No encontré el cuadro";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      } else if (ok === "empty") {
        sendBtn.textContent = "El cuadro está vacío";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      } else if (ok === "no-send-button") {
        sendBtn.textContent = "No encontré el botón Enviar";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      }
      // ok === "cancelled": el usuario dijo que no en el confirm(), no se toca nada.
    });

    card.markInserted = () => {
      insertBtn.textContent = "Insertado ✓ (revisa y envía tú)";
      sendBtn.disabled = false;
      sendBtn.title = "";
    };

    pushCard(card);
    return card;
  }

  /* ================================================================ */
  /* Tarjeta de pedido de flames (spec 002): entendió · datos · pasos · aprobar */
  /* ================================================================ */
  /* ================================================================ */
  /* Fotos del chat (spec 003): bajar · reducir · leer en el servidor · dibujar */
  /* ================================================================ */
  const MERGE_WINDOW_MS = 2 * 60 * 1000; // texto y foto del mismo autor dentro de este plazo son un solo pedido
  const openCards = new Map(); // autor -> { card, ts }: tarjeta de flames abierta a la que puede llegar una foto después
  const pendingPhotos = new Map(); // autor -> { images, ts }: foto que llegó antes que su texto
  const DOC_TYPE_LABELS = { paper: "Ticket de papel", screen: "Pantalla de Gravity", unknown: "Tipo no identificado" };
  const NOT_FOUND_LABELS = { receipt_number: "Receipt Number", park_header: "Parque", date: "Fecha", flames_line: "Línea de flames" };

  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Las fotos del chat son miniaturas. Al hacer clic en una, Connecteam la amplía: se abre el visor, se toma la imagen
   * más grande que aparece y se cierra. Es un intento con mejor esfuerzo (no verificado contra el DOM real del visor):
   * si algo falla, se sigue con la miniatura.
   */
  async function tryLightbox(url) {
    try {
      const file = url.split("?")[0].split("/").pop();
      const thumb = Array.from(document.querySelectorAll(SEL.attachmentImg)).find((i) => (i.currentSrc || i.src || "").includes(file));
      if (!thumb) return null;
      const baseW = thumb.naturalWidth || 0;
      thumb.click();
      await sleepMs(1000);
      const bigger = Array.from(document.images)
        .filter((i) => i !== thumb && !panelHost.contains(i) && isVisible(i) && i.naturalWidth > Math.max(baseW * 1.3, 500))
        .sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
      const src = bigger ? bigger.currentSrc || bigger.src : null;
      // cerrar el visor: Escape y, si hay un botón de cierre visible, también un clic
      for (const t of [document, window, document.body]) t.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
      document.querySelector('[aria-label*="close" i], [data-testid*="close" i]')?.click?.();
      await sleepMs(300);
      return src;
    } catch (e) {
      log("lightbox falló", e.message);
      return null;
    }
  }

  function gmGetBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        timeout: 20000,
        onload: (r) => (r.status >= 200 && r.status < 300 && r.response ? resolve(r.response) : reject(new Error(`HTTP ${r.status}`))),
        onerror: () => reject(new Error("No se pudo descargar la foto")),
        ontimeout: () => reject(new Error("La descarga de la foto tardó demasiado")),
      });
    });
  }

  /** Baja la foto con la mejor resolución disponible: prueba la URL del mensaje y la variante sin "/mobile/". */
  async function fetchBestImage(src) {
    const urls = [...new Set([src, src.replace("/mobile/", "/")])];
    let best = null;
    for (const u of urls) {
      try {
        const bmp = await createImageBitmap(await gmGetBlob(u));
        if (!best || bmp.width * bmp.height > best.bmp.width * best.bmp.height) best = { bmp, url: u };
        if (best.bmp.width >= 1200) break;
      } catch (e) {
        log("descarga falló", u, e.message);
      }
    }
    if (!best) throw new Error("No pude descargar la foto");
    return best;
  }

  /** Reduce (o amplía si es una miniatura) y codifica en JPEG para enviarla al OCR local. */
  function prepareUpload(bmp) {
    const MAX = 1600;
    const TARGET_SMALL = 1200;
    const longest = Math.max(bmp.width, bmp.height);
    const scale = longest > MAX ? MAX / longest : longest < 900 ? TARGET_SMALL / longest : 1;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("No pude preparar la foto"));
          const fr = new FileReader();
          fr.onload = () => resolve({ canvas, base64: String(fr.result).split(",")[1], lowRes: longest < 900 });
          fr.onerror = () => reject(new Error("No pude codificar la foto"));
          fr.readAsDataURL(blob);
        },
        "image/jpeg",
        0.85,
      );
    });
  }

  /** Dibuja la foto con todo el texto leído (gris) y los hallazgos (color y etiqueta). */
  function drawOverlay(canvas, base, result, selected = -1, maxW = 340) {
    const scale = Math.min(1, maxW / result.width);
    canvas.width = Math.round(result.width * scale);
    canvas.height = Math.round(result.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(150,150,150,.85)";
    for (const l of result.lines) {
      const [x0, y0, x1, y1] = l.box.map((v) => v * scale);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    result.findings.forEach((f, i) => {
      const [x0, y0, x1, y1] = f.box.map((v) => v * scale);
      ctx.lineWidth = i === selected ? 4 : 2;
      ctx.strokeStyle = f.color || "#2563eb";
      ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
      ctx.font = "bold 10px system-ui, sans-serif";
      const tw = ctx.measureText(f.label).width + 6;
      const ty = Math.max(12, y0 - 2);
      ctx.fillStyle = f.color || "#2563eb";
      ctx.fillRect(x0 - 1, ty - 11, tw, 12);
      ctx.fillStyle = "#fff";
      ctx.fillText(f.label, x0 + 2, ty - 1);
    });
  }

  /** Muestra la foto con cajas, la lista de hallazgos con su confianza y lo que no se encontró. */
  function renderPhoto(container, base, result, meta) {
    const canvas = el("canvas", { className: "vcanvas" });
    let selected = -1;
    const redraw = () => drawOverlay(canvas, base, result, selected);
    redraw();

    const rows = result.findings
      .map((f, i) => ({ f, i }))
      .sort((a, b) => Number(a.f.ignored) - Number(b.f.ignored))
      .map(({ f, i }) => {
        const pct = Math.round(f.score * 100);
        const shown = Array.isArray(f.value) ? f.value.join(" · ") : f.value ?? f.text;
        const dot = el("span", { className: "dot2" });
        dot.style.background = f.color || "#2563eb";
        const li = el("li", { title: "Clic para resaltar en la foto" }, [
          dot,
          el("span", { textContent: `${f.label}: ${shown}` }),
          el("span", { className: f.lowConfidence ? "low" : "", textContent: `${f.lowConfidence ? "⚠ " : ""}${pct}%` }),
        ]);
        if (f.ignored) li.style.opacity = ".6";
        li.addEventListener("click", () => {
          selected = selected === i ? -1 : i;
          redraw();
        });
        return li;
      });

    const notFound = result.notFound.map((k) => NOT_FOUND_LABELS[k] || k);
    const bigBtn = el("button", { textContent: "Abrir grande" });
    bigBtn.addEventListener("click", () => {
      const big = document.createElement("canvas");
      drawOverlay(big, base, result, selected, result.width);
      big.toBlob((b) => b && window.open(URL.createObjectURL(b), "_blank"));
    });

    container.replaceChildren(
      el("div", { className: "meta", textContent: `Foto leída (${DOC_TYPE_LABELS[result.docType] || DOC_TYPE_LABELS.unknown}): ${meta.orig[0]}×${meta.orig[1]} px · ${meta.secs} s${meta.viaLightbox ? " · ampliada desde Connecteam" : ""}${meta.lowRes ? " · ⚠ baja resolución" : ""}${result.facts && result.facts.boosted ? ` · releída ampliada ×${result.facts.boosted.join(" y ×")}${result.facts.receiptVotes ? ` (recibo en ${result.facts.receiptVotes} lectura(s))` : ""}` : ""}` }),
      canvas,
      el("ul", { className: "finds" }, rows),
      notFound.length ? el("div", { className: "nf", textContent: `No encontrado: ${notFound.join(", ")}` }) : el("span"),
      el("div", { className: "actions" }, [bigBtn]),
    );
  }

  // Parques (127) del directorio del servidor (spec 004). Se piden una vez; si falla, el selector queda con lo detectado.
  let parkOptions = [];
  let parksLoaded = false;
  async function ensureParks() {
    if (parksLoaded) return;
    try {
      const r = await callBackend({ action: "list_parks" });
      if (r.contract === EXPECTED_CONTRACT && Array.isArray(r.parks)) {
        parkOptions = r.parks;
        parksLoaded = true;
      }
    } catch (e) {
      log("list_parks falló:", e.message);
    }
  }
  const PROTOCOL_LABELS = {
    test_card: "Protocolo: Test card · $10 = 50 flames, sin recibo",
    receipt: "Protocolo: con recibo (Gravity → Amusement)",
    out_of_scope: "Fuera de alcance de flames → se escala",
  };

  function addFlameCard(data, first) {
    let analysis = first;
    let approved = false;
    let seq = 0;
    let timer = null;
    let lastReply = "";
    const edited = {}; // solo lo que Juan corrigió viaja como override (y cuenta como confirmado)

    const logEvent = (payload) =>
      callBackend({ action: "log_event", caseId: data.caseId, ...payload }).catch((e) => log("log_event falló:", e.message));

    const badge = el("div", { className: "badge case" });
    const understood = el("div", { className: "understood" });
    const visionEl = el("div", { className: "vision" }); // fotos leídas (spec 003)
    const parkSel = el("select", {}, [
      el("option", { value: "", textContent: "— elegir —" }),
      ...parkOptions.map((o) => el("option", { value: o.key, textContent: o.code })),
    ]);
    const cardIn = el("input", { type: "text", inputMode: "numeric", placeholder: "10 dígitos" });
    const receiptIn = el("input", { type: "text", inputMode: "numeric", placeholder: "Receipt Number (8 dígitos)" });
    const flamesIn = el("input", { type: "number", min: "1", placeholder: "se leerá del recibo" });
    const amountIn = el("input", { type: "number", min: "0", step: "0.01", placeholder: "se leerá del recibo" });
    const f0 = first.fields || {};
    if (f0.parkKey && !parkOptions.some((o) => o.key === f0.parkKey)) parkSel.append(el("option", { value: f0.parkKey, textContent: f0.parkCode || f0.parkKey }));
    parkSel.value = f0.parkKey || "";
    cardIn.value = f0.card || "";
    receiptIn.value = f0.receiptNumber || "";
    flamesIn.value = f0.flames ?? "";
    amountIn.value = f0.amountUsd ?? "";

    // Cada fila (etiqueta + control) se puede ocultar según el protocolo.
    const rows = {};
    const fieldsEl = el("div", { className: "fields" });
    const addRow = (key, label, control) => {
      const l = el("span", { textContent: label });
      rows[key] = [l, control];
      fieldsEl.append(l, control);
    };
    addRow("park", "Parque", parkSel);
    addRow("card", "Tarjeta", cardIn);
    addRow("receipt", "Recibo #", receiptIn);
    addRow("flames", "Flames", flamesIn);
    addRow("amount", "Monto $", amountIn);
    addRow("who", "Pidió", el("strong", { textContent: data.author || "Desconocido" }));
    const showRow = (key, on) => rows[key].forEach((n) => (n.style.display = on ? "" : "none"));

    const blockersEl = el("ul", { className: "blockers" });
    const pendingEl = el("ul", { className: "pending" });
    const warnEl = el("ul", { className: "warns" });
    const gravNote = el("div", { className: "meta" }); // estado de la consulta a Gravity
    const gravRetry = el("button", { textContent: "Actualizar", title: "Volver a pedir la lectura a Gravity" });
    gravRetry.style.display = "none";
    gravRetry.addEventListener("click", () => {
      const n = analysis.fields && analysis.fields.receiptNumber;
      if (n) askGravity(n);
    });
    const evidenceEl = el("div", { className: "evidence" }); // evidencia y veredicto de Gravity
    const readEl = el("ol", { className: "steps" });
    const execEl = el("ol", { className: "steps" });
    const stepsWrap = el("div", {}, [
      el("div", { className: "sec", textContent: "Antes del botón verde (solo lectura)" }),
      readEl,
      el("div", { className: "sec", textContent: "Al aprobar (ejecución)" }),
      execEl,
    ]);
    const replyTitle = el("div", { className: "sec" });
    const qArea = el("textarea", {});
    const insertBtn = el("button", { className: "primary", textContent: "Insertar" });
    const sendBtn = el("button", { className: "danger", textContent: "Enviar", disabled: true, title: "Primero inserta el texto en el cuadro" });
    const qWrap = el("div", {}, [replyTitle, qArea, el("div", { className: "actions" }, [insertBtn, sendBtn])]);

    const goBtn = el("button", { className: "go", textContent: "Aprobar y ejecutar", disabled: true });
    const denyBtn = el("button", { textContent: "Negar" });
    const status = el("div", { className: "meta" });

    const card = el("div", { className: "card flames" }, [
      el("div", { className: "meta", textContent: `Pedido de flames · ${new Date().toLocaleTimeString()}` }),
      el("div", { className: "orig", textContent: `“${data.text}”` }),
      badge,
      el("div", { className: "sec", textContent: "Qué entendí" }),
      understood,
      visionEl,
      el("div", { className: "sec", textContent: "Información capturada" }),
      fieldsEl,
      blockersEl,
      warnEl,
      gravNote,
      gravRetry,
      evidenceEl,
      pendingEl,
      stepsWrap,
      qWrap,
      el("div", { className: "actions" }, [goBtn, denyBtn]),
      status,
    ]);

    function render() {
      const a = analysis;
      const f = a.fields || {};
      const oos = a.protocol === "out_of_scope";
      const test = a.protocol === "test_card";

      badge.textContent = PROTOCOL_LABELS[a.protocol] || "";
      understood.textContent = a.understood;
      fieldsEl.style.display = oos ? "none" : "";
      stepsWrap.style.display = oos ? "none" : "";
      showRow("receipt", a.protocol === "receipt");
      showRow("flames", !oos);
      showRow("amount", !oos);
      flamesIn.disabled = amountIn.disabled = test; // en test card son fijos: $10 = 50 flames
      if (test || !edited.flames) flamesIn.value = f.flames ?? "";
      if (test || !edited.amountUsd) amountIn.value = f.amountUsd ?? "";

      // Lo que sale del texto o de la foto se refleja en los campos, salvo lo que ya corrigió una persona.
      if (!edited.parkKey) parkSel.value = f.parkKey || "";
      if (!edited.card) cardIn.value = f.card || "";
      if (!edited.receiptNumber) receiptIn.value = f.receiptNumber || "";
      parkSel.title = f.parkSource ? `Fuente: ${f.parkSource}` : "";
      receiptIn.title = f.receiptSource ? `Fuente: ${f.receiptSource}` : "";
      parkSel.classList.toggle("bad", !f.parkKey || f.locationId == null);
      cardIn.classList.toggle("bad", !f.card || !f.cardConfirmed);
      receiptIn.classList.toggle("bad", a.protocol === "receipt" && (!f.receiptNumber || !f.receiptConfirmed));

      blockersEl.replaceChildren(...a.blockers.map((b) => el("li", { textContent: b })));
      renderEvidence(a);
      warnEl.replaceChildren(...(a.warnings || []).map((w) => el("li", { textContent: `⚠ ${w}` })));
      pendingEl.replaceChildren(...a.pendingChecks.map((b) => el("li", { textContent: `⏳ ${b}` })));
      readEl.replaceChildren(...a.steps.read.map((s) => el("li", { textContent: s })));
      execEl.replaceChildren(...a.steps.execute.map((s) => el("li", { textContent: s })));

      qWrap.style.display = a.reply ? "" : "none";
      replyTitle.textContent = a.replyKind === "escalation" ? "Respuesta al staff (en inglés)" : "Pregunta al staff (en inglés)";
      if (!qArea.value || qArea.value === lastReply) qArea.value = a.reply || "";
      lastReply = a.reply || "";

      goBtn.style.display = oos ? "none" : "";
      denyBtn.textContent = oos ? "Descartar" : "Negar";
      goBtn.disabled = approved || !a.canApprove;
      goBtn.title = a.canApprove ? "" : a.pendingChecks[0] || "Faltan datos o hay una guarda sin cumplir";
      if (!approved) {
        status.textContent = a.dataReady && a.pendingChecks.length
          ? "Datos completos ✓. El botón verde se habilita cuando existan las lecturas de Gravity y Amusement."
          : "";
      }
    }

    /* ---- Lectura en Gravity (solo lectura): el panel la pide y el lector de tu pestaña de Gravity la atiende ---- */
    const askedReceipts = new Set(); // Receipt Numbers que ya se consultaron en este pedido
    const VERDICT_TEXT = {
      A: "Caso A: Gravity tiene los flames y la tarjeta coincide → falló la carga en Amusement (se resuelve).",
      B: "Caso B: el recibo o la tarjeta no coinciden → se propone pedir al staff que lo rectifique.",
      escalate: "Fuera de lo previsto → se escala (Allow me take a look).",
    };

    function renderEvidence(a) {
      const ev = a.evidence || [];
      evidenceEl.replaceChildren();
      if (!ev.length) return;
      const list = el(
        "ul",
        { className: "ev-list" },
        ev.map((c) => el("li", { className: `ev-${c.status}`, textContent: `${c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : "·"} ${c.label}${c.detail ? " — " + c.detail : ""}` })),
      );
      const banner = VERDICT_TEXT[a.verdict] ? el("div", { className: `verdict verdict-${a.verdict}`, textContent: VERDICT_TEXT[a.verdict] }) : el("span");
      evidenceEl.append(el("div", { className: "sec", textContent: "Evidencia leída en Gravity" }), list, banner);
    }

    async function askGravity(receiptNumber) {
      askedReceipts.add(receiptNumber);
      gravNote.textContent = "Pidiendo la lectura del recibo a Gravity…";
      try {
        const c = await callBackend({ action: "lookup_create", caseId: data.caseId, system: "gravity", kind: "transaction", params: { receiptNumber } });
        const id = c.job.id;
        const t0 = Date.now();
        for (;;) {
          if (!card.isConnected) return; // el pedido se cerró
          const s = await callBackend({ action: "lookup_status", id });
          if (s.status === "done") break;
          if (s.status === "error") throw new Error(s.error || "El lector de Gravity falló");
          if (s.status === "expired" || Date.now() - t0 > 90000) {
            askedReceipts.delete(receiptNumber);
            gravNote.textContent = "No pude leer Gravity: abre una pestaña de Gravity con tu sesión iniciada y pulsa Actualizar.";
            gravRetry.style.display = "";
            return;
          }
          gravNote.textContent = s.status === "taken" ? "Leyendo el recibo en Gravity…" : "Esperando al lector de Gravity (¿hay una pestaña de Gravity abierta con sesión?)…";
          await new Promise((r) => setTimeout(r, 1500));
        }
        gravNote.textContent = "";
        gravRetry.style.display = "none";
        await reanalyze();
      } catch (e) {
        askedReceipts.delete(receiptNumber);
        gravNote.textContent = `No pude leer Gravity: ${e.message}`;
        gravRetry.style.display = "";
      }
    }

    // Se pide solo una vez por Receipt Number, en cuanto existe (aunque venga de la foto con baja confianza: Gravity lo confirma).
    function maybeAskGravity(a) {
      const n = a.fields && a.fields.receiptNumber;
      if (a.protocol !== "receipt" || !n || (a.evidence && a.evidence.length) || askedReceipts.has(n)) return;
      askGravity(n);
    }

    async function reanalyze() {
      const mine = ++seq;
      const overrides = {};
      if (edited.parkKey && parkSel.value) overrides.parkKey = parkSel.value;
      if (edited.card && cardIn.value.trim()) overrides.card = cardIn.value;
      if (edited.receiptNumber && receiptIn.value.trim()) overrides.receiptNumber = receiptIn.value;
      if (edited.flames && flamesIn.value !== "") overrides.flames = Number(flamesIn.value);
      if (edited.amountUsd && amountIn.value !== "") overrides.amountUsd = Number(amountIn.value);
      try {
        const a = await callBackend({ action: "analyze_flames", caseId: data.caseId, messageKey: messageKey(null, data), messageId: data.id, images: data.images || [], text: data.text, author: data.author, overrides });
        if (mine !== seq) return; // llegó una respuesta más nueva
        analysis = a;
        render();
        maybeAskGravity(a);
      } catch (e) {
        status.textContent = `Error al re-evaluar: ${e.message}`;
      }
    }

    const touch = (key) => () => {
      edited[key] = true;
      clearTimeout(timer);
      timer = setTimeout(reanalyze, 350);
    };
    parkSel.addEventListener("change", touch("parkKey"));
    cardIn.addEventListener("input", touch("card"));
    receiptIn.addEventListener("input", touch("receiptNumber"));
    flamesIn.addEventListener("input", touch("flames"));
    amountIn.addEventListener("input", touch("amountUsd"));

    insertBtn.addEventListener("click", () => {
      insertReplyToOriginal(data, qArea.value, (ok) => {
        if (!ok) insertBtn.textContent = "No encontré el cuadro";
        else card.markQuestionInserted();
      });
    });
    sendBtn.addEventListener("click", () => {
      const ok = confirmAndSend();
      if (ok === "sent") {
        sendBtn.textContent = "Enviado ✓";
        sendBtn.disabled = true;
        logEvent({ kind: "reply", title: "Juan envió la respuesta al staff", detail: qArea.value });
      } else if (ok !== "cancelled") {
        sendBtn.textContent = "No se pudo enviar";
        setTimeout(() => (sendBtn.textContent = "Enviar"), 2500);
      }
    });
    card.markQuestionInserted = () => {
      insertBtn.textContent = "Insertado ✓ (revisa y envía tú)";
      sendBtn.disabled = false;
      sendBtn.title = "";
    };

    // Solo un clic humano real aprueba (constitución, principio 1). La ejecución en Amusement
    // llega en tareas posteriores; por ahora la aprobación se registra en los logs.
    goBtn.addEventListener("click", (ev) => {
      if (!ev.isTrusted || goBtn.disabled) return;
      approved = true;
      goBtn.disabled = true;
      goBtn.textContent = "Aprobado ✓";
      status.textContent = "Aprobación registrada en los logs. La ejecución en Amusement todavía no está conectada.";
      logEvent({ kind: "approval", title: "Juan aprobó el protocolo", detail: analysis.understood, data: { fields: analysis.fields }, outcome: "prepared_for_human" });
    });
    denyBtn.addEventListener("click", () => {
      if (analysis.protocol !== "out_of_scope") {
        logEvent({ kind: "approval", title: "Juan negó el pedido", detail: analysis.understood, outcome: "denied" });
      }
      card.remove();
    });

    // Fotos: se leen en el servidor y, al volver, se re-evalúa el pedido con lo que dice el ticket.
    async function addPhoto(url) {
      const note = el("div", { className: "meta", textContent: "Descargando la foto…" });
      const box = el("div", { className: "photo" }, [note]);
      visionEl.append(box);
      const t0 = Date.now();
      try {
        let best = await fetchBestImage(url);
        let viaLightbox = false;
        // Miniatura (< 900 px): se intenta conseguir la versión ampliada que muestra Connecteam al hacer clic.
        if (Math.max(best.bmp.width, best.bmp.height) < 900) {
          note.textContent = "La foto es pequeña: intentando abrirla ampliada en Connecteam…";
          const bigSrc = await tryLightbox(url);
          if (bigSrc && bigSrc !== url) {
            try {
              const big = await fetchBestImage(bigSrc);
              if (big.bmp.width * big.bmp.height > best.bmp.width * best.bmp.height) {
                best = big;
                viaLightbox = true;
              }
            } catch (e) {
              log("foto ampliada no descargable", e.message);
            }
          }
        }
        const up = await prepareUpload(best.bmp);
        note.textContent = `Leyendo la foto (${best.bmp.width}×${best.bmp.height})… el OCR tarda unos segundos`;
        const result = await callBackend({ action: "read_image", caseId: data.caseId, mime: "image/jpeg", imageBase64: up.base64 }, 90000);
        renderPhoto(box, up.canvas, result, { orig: [best.bmp.width, best.bmp.height], lowRes: up.lowRes, viaLightbox, secs: ((Date.now() - t0) / 1000).toFixed(1) });
        await reanalyze();
      } catch (e) {
        box.replaceChildren(el("div", { className: "blockers", textContent: /^No pude/.test(e.message) ? e.message : `No pude leer la foto: ${e.message}` }));
      }
    }
    card.addImages = (urls) => urls.forEach((u) => addPhoto(u));

    render();
    pushCard(card);
    maybeAskGravity(analysis);
    return card;
  }

  function addErrorCard(data, message) {
    setStatus("error");
    pushCard(
      el("div", { className: "card err" }, [
        el("div", { className: "meta", textContent: `${data.author || "Desconocido"} · error` }),
        el("div", { className: "orig", textContent: `“${data.text}”` }),
        el("div", { textContent: message }),
      ]),
    );
  }

  /* ================================================================ */
  /* Comandos de la consola de tickets (spec 006): insertar o enviar una */
  /* respuesta en Connecteam, citando al staff                          */
  /* ================================================================ */
  /** Id del mensaje a citar. Se confirma por contenido (en casos reales dos mensajes compartieron id). */
  function findStaffMessageId(p) {
    const snippet = norm(p.snippet || "").slice(0, 60).toLowerCase();
    const textOf = (wrapper) => norm(extractText(wrapper.querySelector(SEL.message) || wrapper)).toLowerCase();
    const byId = p.messageId ? document.querySelector(`[data-message-id="${CSS.escape(p.messageId)}"]`) : null;
    if (byId && (!snippet || textOf(byId).includes(snippet))) return p.messageId;
    if (snippet) {
      const hit = Array.from(document.querySelectorAll(SEL.messageWrapper)).reverse().find((w) => textOf(w).includes(snippet));
      if (hit) return hit.getAttribute("data-message-id") || "";
    }
    return byId ? p.messageId : ""; // sin coincidencia por contenido: el id tal cual (mejor esfuerzo)
  }

  async function runCommand(cmd) {
    const report = (ok, error, note) => callBackend({ action: "command_result", id: cmd.id, ok, error: error || "", note: note || "" }).catch(() => {});
    if (!isTargetChannel()) return report(false, "Connecteam no está en el chat Gravity Support: ábrelo en esta pestaña y reintenta.");
    const p = cmd.params;
    if (cmd.type === "insert_reply") {
      // Si el cuadro solo tiene la sugerencia automática (o ya esta misma respuesta) se reemplaza; si tiene texto de una persona, no se pisa.
      const box = findComposer();
      if (box && !composerIsEmpty(box)) {
        const cur = norm(box.isContentEditable ? box.innerText : box.value);
        if (cur === pendingAiText || cur === norm(p.text)) clearComposer(box);
        else return report(false, "El cuadro de Connecteam ya tiene texto escrito: envíalo o bórralo y vuelve a intentarlo (no se pisa lo que escribe una persona).");
      }
      const id = findStaffMessageId(p);
      insertReplyToOriginal({ id }, p.text, (ok, quoted) =>
        report(ok, ok ? "" : "No encontré el cuadro de texto de Connecteam.", ok && !quoted ? "No encontré el mensaje del staff en pantalla: la respuesta se insertó sin citarlo." : ""),
      );
      return;
    }
    if (cmd.type === "send_reply") {
      const r = confirmAndSend({ skipConfirm: true, expectedText: p.text });
      const why = {
        sent: "",
        cancelled: "Cancelado.",
        "no-composer": "No encontré el cuadro de texto de Connecteam.",
        empty: "El cuadro de Connecteam está vacío: inserta primero la respuesta.",
        "no-send-button": "No encontré el botón Enviar de Connecteam.",
        changed: "El texto del cuadro cambió desde que se insertó: no se envió. Vuelve a insertar y envía.",
      }[r];
      report(r === "sent", why);
      return;
    }
    report(false, `Comando desconocido: ${cmd.type}`);
  }

  let cmdBusy = false;
  async function pollCommands() {
    if (cmdBusy) return;
    cmdBusy = true;
    try {
      const { command } = await callBackend({ action: "command_next", target: "connecteam" });
      if (command) await runCommand(command);
    } catch {
      /* servidor apagado o sin comandos: se reintenta en el siguiente ciclo */
    } finally {
      cmdBusy = false;
    }
  }

  /* ================================================================ */
  /* Arranque                                                          */
  /* ================================================================ */
  function start() {
    // Si hay dos copias del userscript instaladas, la segunda no arranca (evita tarjetas duplicadas).
    if (document.getElementById("ke-assistant-panel")) {
      console.warn("[KE] Ya hay otra copia de KE Assistant corriendo en esta página; revisa Tampermonkey por scripts duplicados.");
      return;
    }
    document.body.append(panelHost);
    if (/PEGA_AQUI|__SHARED_SECRET__/.test(CONFIG.SHARED_SECRET)) {
      addErrorCard({ author: "Configuración", text: "Placeholder sin reemplazar" },
        "Este script no trae el secreto: instálalo desde http://127.0.0.1:8787/userscript/connecteam-listener-v2.user.js con el servidor local corriendo (el servidor se lo agrega).");
      return;
    }
    setStatus("working");
    installEnterGuard();
    new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
    scheduleArm();
    setInterval(() => armed && evaluateTail(), RESCAN_INTERVAL_MS);
    setInterval(pollCommands, 2000); // órdenes de la consola de tickets (insertar o enviar una respuesta)
  }

  start();
})();
