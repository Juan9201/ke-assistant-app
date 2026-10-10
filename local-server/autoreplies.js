/**
 * Respuestas automáticas por mensaje (spec 008). Reglas deterministas: proponen un texto, una persona lo revisa y lo envía.
 */

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ").trim();

// Pide un reembolso: verbo de pedir/necesitar antes de "refund" ("can we get a refund?", "needs a refund", "requesting a refund").
const ASKS = /\b(need|needs|needed|needing|want|wants|request|requests|requesting|process|processed|processing|get|give|issue|do)\b[^.?!\n]{0,40}\brefunds?\b/;
const ASKS_AFTER = /\brefunds?\b[^.?!\n]{0,20}\b(please|pls|needed)\b/;
const DENIES = /\b(no need|not need|dont need|do not need|doesnt need|does not need|dont want|do not want)\b/;

export function isRefundRequest(text) {
  const t = fold(text);
  if (!/\brefunds?\b/.test(t) || DENIES.test(t)) return false;
  return ASKS.test(t) || ASKS_AFTER.test(t);
}

const YES = /\b(yes|yeah|yep|yup|yea|sure|correct|done|did|submitted|affirmative|already|ok|okay)\b/;
const NO = /\b(no|nope|not|never|havent|didnt|dont|wont)\b/;

/**
 * Lee la respuesta del staff a "did you submit the refund request?".
 * Devuelve "yes" | "no" | "unclear" (corta pero ambigua) | "not_answer" (larga o con pregunta: es otro tema).
 */
export function readYesNo(text) {
  const t = fold(text);
  if (!t) return "not_answer";
  if (t.includes("?") || t.split(" ").length > 12) return "not_answer";
  const yes = YES.test(t);
  const no = NO.test(t);
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

export const REFUND_TEXTS = {
  ask: (name) => (name ? `${name}, did you submit the refund request, correct?` : "Did you submitted the refund request, correct?"),
  yes: "Thank you so much! We will review it.",
  no: "Understood, feel free to do so!! Thank you.",
};

const base = (requester) => ({
  isFlameRequest: true, // el flujo de tickets es el mismo; el protocolo distingue (spec 008)
  protocol: "refund",
  requester,
  fields: {},
  missing: [],
  blockers: [],
  warnings: [],
  pendingChecks: [],
  dataReady: false,
  canApprove: false,
  steps: { read: [], execute: [] },
});

/** Análisis de un pedido de reembolso: stage "asked" (pregunta hecha), "submitted", "declined" o "unclear". */
export function refundAnalysis({ stage, author = "", greetingName = "" }) {
  const b = { ...base(author), refundStage: stage };
  if (stage === "asked") return { ...b, understood: "Pide un reembolso: se le pregunta si ya envió la solicitud (R2: nunca se ejecuta desde aquí).", reply: REFUND_TEXTS.ask(greetingName), replyKind: "question" };
  if (stage === "submitted") return { ...b, understood: "Dice que ya envió la solicitud de reembolso: se le agradece y queda para que Juan la revise.", reply: REFUND_TEXTS.yes, replyKind: "answer" };
  if (stage === "declined") return { ...b, understood: "Dice que todavía no envió la solicitud de reembolso: se le indica que puede hacerlo.", reply: REFUND_TEXTS.no, replyKind: "answer" };
  return { ...b, understood: "Respondió algo que no es un sí ni un no claro sobre la solicitud de reembolso: lo revisa Juan.", reply: null, replyKind: null, warnings: ["Respuesta poco clara: léela y contesta tú."] };
}
