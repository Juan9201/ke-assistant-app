// ==UserScript==
// @name         KE Assistant — Gravity reader
// @namespace    https://github.com/Juan9201/ke-assistant
// @version      1.0.0
// @description  Lee recibos de Gravity (SOLO LECTURA) cuando el asistente lo pide, con tu sesión abierta. No modifica nada.
// @match        https://access.thegravityapp.io/*
// @grant        GM_xmlhttpRequest
// @updateURL    http://127.0.0.1:8787/userscript/gravity-reader.user.js
// @downloadURL  http://127.0.0.1:8787/userscript/gravity-reader.user.js
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==
//
// Qué hace: cada pocos segundos le pregunta al servidor local si hay una consulta pendiente. Si la hay, pide el detalle
// del recibo a la API de Gravity (la misma que usa Reports → pos-transaction), se queda SOLO con campos operativos
// (parque, fecha, POS, total, líneas, pagos y los códigos de las tarjetas de flames) y lo devuelve al servidor.
// Nunca envía nombres de clientes, teléfonos ni correos. Nunca escribe nada en Gravity (solo GET).
// El marcador __SHARED_SECRET__ lo reemplaza el servidor al entregar este archivo.

(function () {
  "use strict";

  const CONFIG = {
    BACKEND_URL: "http://127.0.0.1:8787",
    SHARED_SECRET: "__SHARED_SECRET__",
    POLL_MS: 2500,
  };
  const VERSION = "1.0.0";

  /* ---------------- Servidor local ---------------- */
  function backend(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: CONFIG.BACKEND_URL,
        headers: { "Content-Type": "application/json", "X-Shared-Secret": CONFIG.SHARED_SECRET },
        data: JSON.stringify(payload),
        timeout: 15000,
        onload: (r) => {
          let body = null;
          try {
            body = JSON.parse(r.responseText);
          } catch {
            /* se reporta abajo */
          }
          if (r.status >= 200 && r.status < 300 && body) resolve(body);
          else reject(new Error((body && body.error) || `HTTP ${r.status}`));
        },
        onerror: () => reject(new Error("No se pudo contactar al servidor local")),
        ontimeout: () => reject(new Error("El servidor local tardó demasiado")),
      });
    });
  }

  /* ---------------- Lectura de Gravity (solo GET) ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getTransaction(receiptNumber) {
    const url = `/api/CheckOut/transactionDetail/${encodeURIComponent(receiptNumber)}/maskCardNumber/false/true`;
    let r = await fetch(url, { credentials: "same-origin" });
    // Un número que no existe responde 500 (observado): se reintenta una vez antes de darlo por inexistente.
    if (r.status >= 500) {
      await sleep(800);
      r = await fetch(url, { credentials: "same-origin" });
    }
    return r;
  }

  /**
   * Reduce la respuesta de Gravity a campos operativos. Todo lo demás (clientes, cajero, correos, teléfonos) se descarta aquí,
   * y el servidor lo vuelve a filtrar.
   */
  function reduceTransaction(j, requested) {
    const tc = j && j.transactionComplete;
    const o = tc && tc.originalTransaction;
    // Si no hay una transacción (p. ej. el número corresponde a otra cosa, como una tarjeta regalo), no se lee nada.
    if (!o || Number(o.id) !== Number(requested)) return { found: false, reason: "not_a_transaction" };
    return {
      found: true,
      transactionId: o.id,
      venueId: o.venueId,
      venueName: tc.venue && tc.venue.name,
      date: o.transactionDate,
      deviceName: o.deviceName,
      total: o.total,
      status: o.transactionStatus,
      type: o.transactionType,
      note: o.transactionNote,
      products: (o.products || []).map((p) => ({ name: p.varietyName, qty: p.quantity, price: p.price, gpCardType: p.gpCardType })),
      gpCards: (o.gpCards || []).map((g) => ({ code: g.code, originalBalance: g.originalBalance, remainingBalance: g.remainingBalance, gpCardType: g.gpCardType })),
      payments: (o.payments || []).map((p) => ({ type: p.description || (p.paymentType && p.paymentType.name), amount: p.amount })),
    };
  }

  async function readTransaction(receiptNumber) {
    const r = await getTransaction(receiptNumber);
    if (r.status === 401 || r.status === 403) throw new Error("La sesión de Gravity caducó: inicia sesión en esta pestaña");
    if (r.status === 400 || r.status === 404 || r.status === 204 || r.status >= 500) return { found: false, httpStatus: r.status };
    if (!r.ok) throw new Error(`Gravity respondió ${r.status}`);
    let j = null;
    try {
      j = await r.json();
    } catch {
      return { found: false, httpStatus: r.status, reason: "not_json" };
    }
    return reduceTransaction(j, receiptNumber);
  }

  /* ---------------- Indicador y ciclo ---------------- */
  const pill = document.createElement("div");
  pill.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px system-ui,sans-serif;background:#fff;color:#1f2328;border:1px solid #d0d7de;border-radius:14px;padding:3px 10px;box-shadow:0 2px 8px rgba(0,0,0,.15);opacity:.85;pointer-events:none";
  const setPill = (text, color) => {
    pill.textContent = `● KE lector de Gravity v${VERSION} · ${text}`;
    pill.style.borderColor = color;
  };
  setPill("listo", "#1a7f37");
  document.body.append(pill);

  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const { job } = await backend({ action: "lookup_next", system: "gravity" });
      if (!job) {
        setPill("listo", "#1a7f37");
        return;
      }
      setPill(`leyendo #${job.params.receiptNumber}…`, "#bf8700");
      try {
        const data = await readTransaction(job.params.receiptNumber);
        await backend({ action: "lookup_result", id: job.id, ok: true, data });
        setPill(`recibo #${job.params.receiptNumber} leído`, "#1a7f37");
      } catch (e) {
        await backend({ action: "lookup_result", id: job.id, ok: false, error: e.message });
        setPill(`error: ${e.message}`, "#cf222e");
      }
    } catch (e) {
      setPill("sin servidor local", "#8c959f"); // el servidor está apagado o el secreto no coincide
    } finally {
      busy = false;
    }
  }
  setInterval(tick, CONFIG.POLL_MS);
  tick();
})();
