/**
 * Operaciones de tickets (spec 006): une el almacén de tickets, el análisis, las consultas a Gravity, la cola de
 * comandos hacia Connecteam y los logs. Todas las dependencias se inyectan, así se prueba sin levantar el servidor.
 */

import { analyzeFlameRequest } from "./flamerequest.js";
import { loadParks, matchPark } from "./parks.js";

const LOOKUP_RETRY_MS = 60_000;

export function createTicketOps({ tickets, commands, lookups, log, visionFor = () => null, gravityFor = () => null, greetingNameFor = () => "", analyze = analyzeFlameRequest, now = () => Date.now() }) {
  const safeLog = (fn) => {
    try {
      fn();
    } catch (e) {
      console.error("No se pudo escribir el log:", e.message); // un fallo de log nunca debe tumbar la operación
    }
  };
  const lookupAsked = new Map(); // ticketId -> { receipt, ts }

  const run = (ticket, text, overrides = {}) =>
    analyze({
      text,
      author: ticket.author,
      greetingName: greetingNameFor(ticket.author),
      overrides: { ...ticket.overrides, ...overrides },
      vision: visionFor(ticket.caseId),
      gravity: gravityFor(ticket.caseId),
    });

  // La firma de un análisis: si no cambia, no se vuelve a guardar ni a registrar.
  const sig = (a) => JSON.stringify([a.protocol, a.verdict, a.blockers, a.reply, a.fields, (a.evidence || []).map((e) => e.status)]);

  /** ¿El mensaje nuevo parece la respuesta a lo que se le preguntó al staff (y no un tema aparte)? */
  function looksLikeAnswer(text, images) {
    if (images && images.length) return true;
    const t = String(text || "");
    if (/\d{6,}/.test(t)) return true;
    if (matchPark(t, loadParks()).park) return true;
    return t.trim().split(/\s+/).filter(Boolean).length <= 12;
  }

  /** Pide por su cuenta la lectura del recibo a Gravity (no depende de que el widget esté abierto). */
  function ensureGravity(ticket, a) {
    if (a.protocol !== "receipt" || !a.fields?.receiptNumber || (a.evidence && a.evidence.length)) return;
    const receipt = a.fields.receiptNumber;
    const prev = lookupAsked.get(ticket.id);
    if (prev && prev.receipt === receipt && now() - prev.ts < LOOKUP_RETRY_MS) return;
    lookupAsked.set(ticket.id, { receipt, ts: now() });
    const r = lookups.create({ system: "gravity", kind: "transaction", params: { receiptNumber: receipt }, caseId: ticket.caseId });
    if (r.ok && !r.reused) safeLog(() => log.onLookupRequested(ticket.caseId, r.job));
  }

  return {
    /**
     * Mensaje nuevo (o re-evaluación) desde el listener. Devuelve el análisis y su ticket.
     * Los mensajes del mismo staff se suman al ticket que espera su respuesta y el análisis usa el conjunto.
     */
    analyzeMessage({ caseId = "", messageKey = "", messageId = "", author = "", text = "", images = [], overrides = {}, channel = "" }) {
      const incoming = { messageKey: messageKey || caseId, messageId, text, images, ts: now() };
      let found = caseId || author ? tickets.resolve({ caseId, author }) : null;
      if (found && found.continued && !looksLikeAnswer(text, images)) found = null;
      let ticket = found ? found.ticket : null;

      if (ticket) {
        if (Object.keys(overrides).length) tickets.mergeOverrides(ticket.id, overrides); // lo que se corrige en el widget lo ve la consola
        ticket = tickets.get(ticket.id);
      }
      const combined = ticket ? tickets.combinedText(ticket, incoming) : text;
      let analysis = ticket
        ? run(ticket, combined)
        : analyze({ text, author, greetingName: greetingNameFor(author), overrides, vision: visionFor(caseId), gravity: gravityFor(caseId) });

      if (ticket && !analysis.isFlameRequest) {
        // No era una continuación: se analiza solo y, si procede, abre su propio ticket.
        ticket = null;
        analysis = analyze({ text, author, greetingName: greetingNameFor(author), overrides, vision: visionFor(caseId), gravity: gravityFor(caseId) });
      }

      let created = false;
      if (analysis.isFlameRequest) {
        if (ticket) tickets.appendMessage(ticket.id, incoming, caseId);
        else if (caseId) {
          ticket = tickets.create({ ...incoming, caseId, author, channel });
          created = true;
          if (Object.keys(overrides).length) tickets.mergeOverrides(ticket.id, overrides);
        }
        if (ticket) {
          const before = ticket.analysis ? sig(ticket.analysis) : null;
          tickets.setAnalysis(ticket.id, analysis);
          ensureGravity(ticket, analysis);
          const changed = before !== sig(analysis);
          if (created || changed) {
            safeLog(() =>
              log.onAnalysis({ caseId: ticket.caseId, text: combined, author: ticket.author, edited: !created && Object.keys(overrides).length > 0 }, analysis),
            );
          }
          ticket = tickets.get(ticket.id);
        }
      }
      return { analysis, ticket, created, continued: !!found?.continued };
    },

    /** Re-evalúa un ticket con todo lo que se sabe (foto, lectura de Gravity, correcciones). */
    refresh(ticketId) {
      const ticket = tickets.get(ticketId);
      if (!ticket) return null;
      const analysis = run(ticket, tickets.combinedText(ticket));
      if (!analysis.isFlameRequest) return ticket;
      const changed = !ticket.analysis || sig(ticket.analysis) !== sig(analysis);
      tickets.setAnalysis(ticket.id, analysis);
      ensureGravity(ticket, analysis);
      if (changed) safeLog(() => log.onAnalysis({ caseId: ticket.caseId, text: tickets.combinedText(ticket), author: ticket.author, edited: true }, analysis));
      return tickets.get(ticket.id);
    },

    /** Corrección hecha desde la consola. */
    reanalyze({ ticketId, overrides }) {
      const t = tickets.get(ticketId);
      if (!t) return { ok: false, error: "Ticket no encontrado" };
      tickets.mergeOverrides(ticketId, overrides);
      safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "reply", title: "Juan corrigió datos desde la consola de tickets", detail: Object.keys(overrides || {}).join(", ") }));
      return { ok: true, ticket: this.refresh(ticketId) };
    },

    setDraft({ ticketId, text }) {
      return tickets.setDraft(ticketId, text) ? { ok: true } : { ok: false, error: "Ticket no encontrado" };
    },

    /** Pide a Connecteam que inserte (o envíe) la respuesta. Insertar no envía; enviar exige haber insertado ese mismo texto. */
    reply({ ticketId, text, mode }) {
      const t = tickets.get(ticketId);
      if (!t) return { ok: false, error: "Ticket no encontrado" };
      const clean = String(text || "").trim();
      if (!clean) return { ok: false, error: "La respuesta está vacía" };
      const lastStaff = [...t.messages].reverse().find((m) => m.messageId || m.text) || {};
      if (mode === "insert") {
        tickets.setDraft(ticketId, clean);
        const r = commands.create({ type: "insert_reply", params: { ticketId, text: clean, messageId: lastStaff.messageId || "", snippet: (lastStaff.text || "").slice(0, 120) } });
        return r.ok ? { ok: true, command: r.command } : { ok: false, error: r.error };
      }
      if (mode === "send") {
        if (t.lastInserted !== clean) return { ok: false, error: "Primero inserta esta respuesta en Connecteam (y revísala ahí); solo se envía el texto que ya está insertado." };
        const r = commands.create({ type: "send_reply", params: { ticketId, text: clean, messageId: lastStaff.messageId || "", snippet: (lastStaff.text || "").slice(0, 120) } });
        return r.ok ? { ok: true, command: r.command } : { ok: false, error: r.error };
      }
      return { ok: false, error: "mode debe ser insert o send" };
    },

    /** El listener informa el resultado de un comando. */
    commandResult({ id, ok, error, note = "" }) {
      const r = commands.complete(id, { ok: !!ok, error });
      if (!r.ok) return r;
      const c = r.command;
      const t = tickets.get(c.ticketId);
      if (!t) return { ok: true };
      if (ok) {
        if (note) tickets.addThread(t.id, { role: "system", kind: "info", text: String(note).slice(0, 300) }); // p. ej. "se insertó sin citar el mensaje"
        if (c.type === "insert_reply") {
          tickets.addThread(t.id, { role: "juan", kind: "inserted", text: c.params.text });
          tickets.setLastInserted(t.id, c.params.text);
          safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "reply", title: "Respuesta insertada en Connecteam desde la consola (citando al staff)", detail: c.params.text }));
        } else {
          tickets.addThread(t.id, { role: "juan", kind: "sent", text: c.params.text });
          tickets.setLastInserted(t.id, null);
          safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "reply", title: "Juan envió la respuesta al staff desde la consola", detail: c.params.text }));
        }
      } else {
        tickets.addThread(t.id, { role: "system", kind: "error", text: `No se pudo ${c.type === "insert_reply" ? "insertar" : "enviar"} en Connecteam: ${String(error || "error desconocido").slice(0, 300)}` });
        safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "error", title: "Falló un comando hacia Connecteam", detail: String(error || "") }));
      }
      return { ok: true };
    },

    /** Aprobar, negar, resolver o reabrir. Aprobar exige que el análisis lo permita (mismas condiciones que el botón verde). */
    act({ ticketId, action }) {
      const t = tickets.get(ticketId);
      if (!t) return { ok: false, error: "Ticket no encontrado" };
      const a = t.analysis;
      if (action === "approve") {
        if (!a || !a.canApprove) return { ok: false, error: `Todavía no se puede aprobar: ${(a && (a.blockers[0] || a.pendingChecks[0])) || "falta analizar el pedido"}` };
        tickets.setStatus(ticketId, "approved");
        safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "approval", title: "Juan aprobó el protocolo desde la consola de tickets", detail: a.understood, data: { fields: a.fields }, outcome: "prepared_for_human" }));
        return { ok: true, ticket: tickets.get(ticketId) };
      }
      if (action === "deny") {
        tickets.setStatus(ticketId, "denied");
        safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "approval", title: "Juan negó el pedido desde la consola de tickets", detail: a?.understood || "", outcome: "denied" }));
        return { ok: true, ticket: tickets.get(ticketId) };
      }
      if (action === "resolve") {
        tickets.setStatus(ticketId, "resolved");
        safeLog(() => log.onPanelEvent({ caseId: t.caseId, kind: "reply", title: "Juan marcó el ticket como resuelto", detail: "" }));
        return { ok: true, ticket: tickets.get(ticketId) };
      }
      if (action === "reopen") return { ok: true, ticket: tickets.reopen(ticketId) };
      return { ok: false, error: "Acción no permitida" };
    },
  };
}
