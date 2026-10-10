/**
 * Caso aparte: preguntas de reembolso (spec 008). Se engancha antes del análisis de flames y NO usa su lógica:
 * si el mensaje no es de este caso, devuelve `handled: false` y el flujo de flames sigue exactamente igual.
 */

import { isRefundRequest, isRefundSubmittedStatement, isRefundStatusQuestion, readYesNo, refundAnalysis } from "./autoreplies.js";

const RECENT_MS = 2 * 60 * 60 * 1000; // un reembolso de hace menos de 2 h da contexto a "any word with this update"
const nameKey = (a) => String(a || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const sig = (a) => JSON.stringify([a.protocol, a.refundStage, a.reply]);

export function createRefundCase({ tickets, log, greetingNameFor = () => "", isFlames = () => false, now = () => Date.now() }) {
  /** Último ticket de reembolso reciente del mismo staff (cualquier estado). */
  const recentRefund = (author) => {
    const key = nameKey(author);
    if (!key) return null;
    const s = [...tickets.list()].filter((x) => x.protocol === "refund" && nameKey(x.author) === key && now() - x.updatedAt < RECENT_MS).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return s ? tickets.get(s.id) : null;
  };

  const safeLog = (fn) => {
    try {
      fn();
    } catch (e) {
      console.error("No se pudo escribir el log:", e.message);
    }
  };

  /** Un turno: guarda el mensaje, el análisis, el estado y el log. */
  function turn({ ticket, incoming, stage, caseId, author, channel, continued }) {
    const who = ticket ? ticket.author : author;
    const analysis = refundAnalysis({ stage, author: who, greetingName: greetingNameFor(who) });
    let created = false;
    if (ticket) tickets.appendMessage(ticket.id, incoming, caseId);
    else if (caseId) {
      ticket = tickets.create({ ...incoming, caseId, author, channel });
      created = true;
    }
    if (ticket) {
      const before = ticket.analysis ? sig(ticket.analysis) : null;
      tickets.setAnalysis(ticket.id, analysis);
      if (created || before !== sig(analysis)) safeLog(() => log.onAnalysis({ caseId: ticket.caseId, text: incoming.text, author: ticket.author }, analysis));
      ticket = tickets.get(ticket.id);
    }
    return { analysis, ticket, created, continued };
  }

  const same = (ticket) => ({ analysis: ticket.analysis, ticket, created: false, continued: false });

  return {
    /**
     * @returns {{handled:true, result:object} | {handled:false, found:object|null}}
     *   `found` es el ticket candidato, ya sin el ticket de reembolso cuando el mensaje es de otro tema.
     */
    handle({ found, incoming, caseId, author, text, channel }) {
      const prior = found?.ticket?.analysis?.protocol === "refund";

      // Avisos y preguntas sobre un reembolso que ya se pidió (spec 008, reglas 4 y 5).
      const context = prior ? found.ticket : recentRefund(author);
      const stated = isRefundSubmittedStatement(text);
      const status = !stated && isRefundStatusQuestion(text, !!context) && !(!/\brefunds?\b/i.test(text) && isFlames(text, author));
      if (stated || status) {
        const sameCase = found && found.ticket.analysis?.protocol === "refund" && !found.continued;
        if (sameCase && found.ticket.analysis.refundStage === (stated ? "stated" : "status")) return { handled: true, result: same(found.ticket) };
        return { handled: true, result: turn({ ticket: context, incoming, stage: stated ? "stated" : "status", caseId, author, channel, continued: !!found?.continued }) };
      }

      const asks = isRefundRequest(text);
      if (!asks && !prior) return { handled: false, found };

      if (found && prior && !asks) {
        const ans = readYesNo(text);
        if (ans !== "not_answer" && !(isFlames(text, author))) {
          const stage = { yes: "submitted", no: "declined", unclear: "unclear" }[ans];
          return { handled: true, result: turn({ ticket: found.ticket, incoming, stage, caseId, author, channel, continued: found.continued }) };
        }
        // Otro tema (pregunta, mensaje largo, pedido de flames): no se mezcla con el reembolso.
        return found.continued ? { handled: false, found: null } : { handled: true, result: same(found.ticket) };
      }
      if (found && found.continued && !prior) found = null; // un pedido de reembolso no se suma a un ticket de otro caso
      if (found && prior && !found.continued && found.ticket.analysis.refundStage !== "asked") {
        return { handled: true, result: same(found.ticket) }; // re-lectura del primer mensaje: no se retrocede de etapa
      }
      return { handled: true, result: turn({ ticket: found && prior ? found.ticket : null, incoming, stage: "asked", caseId, author, channel, continued: !!found?.continued }) };
    },
  };
}
