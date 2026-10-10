/**
 * Caso aparte: preguntas de reembolso (spec 008). Se engancha antes del análisis de flames y NO usa su lógica:
 * si el mensaje no es de este caso, devuelve `handled: false` y el flujo de flames sigue exactamente igual.
 */

import { isRefundRequest, readYesNo, refundAnalysis } from "./autoreplies.js";

const sig = (a) => JSON.stringify([a.protocol, a.refundStage, a.reply]);

export function createRefundCase({ tickets, log, greetingNameFor = () => "", isFlames = () => false }) {
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
      const asks = isRefundRequest(text);
      const prior = found?.ticket?.analysis?.protocol === "refund";
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
