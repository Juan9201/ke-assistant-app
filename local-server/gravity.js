/**
 * Recibo de Gravity (spec 002, T-07/T-09): normalización y validación. Solo lectura, sin red.
 *
 * El lector (dentro de tu pestaña de Gravity) consulta `GET /api/CheckOut/transactionDetail/{n}/maskCardNumber/false/true`
 * y manda solo un resumen operativo. Aquí se vuelve a filtrar (lista blanca: nunca nombres, teléfonos ni correos)
 * y se decide el veredicto de Juan:
 *   A = Gravity tiene los flames y la tarjeta coincide → falló la carga en Amusement (se resuelve).
 *   B = el staff dio un recibo o una tarjeta equivocados → pedir que rectifique (R-V2).
 *   escalar = algo fuera de lo previsto (no pagado, varias líneas de flames, varias tarjetas, sin PLAY_CARD).
 */

/** `transactionStatus` de una venta completada en Gravity (visto en todos los recibos normales). */
export const COMPLETED_STATUS = 6;
/** `gpCardType` de las tarjetas de flames. */
export const FLAMES_CARD_TYPE = 5;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v, n = 120) => (typeof v === "string" ? v.slice(0, n) : "");

/** Lista blanca: del resumen del lector solo pasan campos operativos, con tipos y largos acotados. */
export function normalizeGravity(raw) {
  if (!raw || typeof raw !== "object") return { found: false, reason: "invalid" };
  if (!raw.found) return { found: false, httpStatus: num(raw.httpStatus), reason: str(raw.reason, 60) || "not_found" };
  return {
    found: true,
    transactionId: num(raw.transactionId),
    venueId: num(raw.venueId),
    venueName: str(raw.venueName, 80),
    date: str(raw.date, 40),
    deviceName: str(raw.deviceName, 80),
    total: num(raw.total),
    status: num(raw.status),
    type: num(raw.type),
    note: str(raw.note, 200),
    products: (Array.isArray(raw.products) ? raw.products : []).slice(0, 60).map((p) => ({ name: str(p?.name, 80), qty: num(p?.qty) ?? 0, price: num(p?.price) ?? 0, gpCardType: num(p?.gpCardType) ?? 0 })),
    gpCards: (Array.isArray(raw.gpCards) ? raw.gpCards : []).slice(0, 20).map((g) => ({ code: str(g?.code, 24), originalBalance: num(g?.originalBalance), remainingBalance: num(g?.remainingBalance), gpCardType: num(g?.gpCardType) ?? 0 })),
    payments: (Array.isArray(raw.payments) ? raw.payments : []).slice(0, 10).map((p) => ({ type: str(p?.type, 40), amount: num(p?.amount) ?? 0 })),
  };
}

const FLAMES_NAME = /\$?\s*(\d+(?:\.\d+)?)\s*=\s*(\d+)\s*flames?/i;

/** Líneas de flames del recibo: "$10 = 50 flames" × cantidad. */
export function flamesLines(g) {
  return g.products
    .filter((p) => p.gpCardType === FLAMES_CARD_TYPE || /flames?/i.test(p.name))
    .map((p) => {
      const m = p.name.match(FLAMES_NAME);
      const perUnit = m ? Number(m[2]) : null;
      const unitAmount = m ? Number(m[1]) : p.price;
      return { name: p.name, qty: p.qty, perUnit, unitAmount, total: perUnit == null ? null : perUnit * p.qty, amount: Math.round(unitAmount * p.qty * 100) / 100 };
    });
}

const B_CHECKS = ["receipt", "venue", "flames_line", "play_card"]; // el staff se equivocó → pedir que rectifique
const ESCALATE_CHECKS = ["paid", "multi_flames", "multi_card", "card_on_receipt"]; // fuera de lo previsto → escalar

/**
 * @param {{gravity: object|null, chatCard?: string|null, expectedVenueId?: number|null}} input
 * @returns {{checks:{id:string,label:string,status:"ok"|"fail"|"warn",detail:string}[], verdict:"pending"|"A"|"B"|"escalate", reason:string|null, facts:object}}
 */
export function evaluateGravity({ gravity, chatCard = null, expectedVenueId = null } = {}) {
  const out = { checks: [], verdict: "pending", reason: null, facts: {} };
  if (!gravity) return out;
  const add = (id, label, status, detail = "") => out.checks.push({ id, label, status, detail });

  if (!gravity.found) {
    add("receipt", "El recibo existe en Gravity", "fail", "No se encontró ese Receipt Number");
    out.verdict = "B";
    out.reason = "receipt_not_found";
    return out;
  }
  add("receipt", "El recibo existe en Gravity", "ok", `#${gravity.transactionId} · ${gravity.venueName} · ${gravity.deviceName} · ${gravity.date.replace("T", " ").slice(0, 16)}`);

  if (expectedVenueId != null) {
    if (expectedVenueId === gravity.venueId) add("venue", "El parque coincide con lo que dijo el staff", "ok", gravity.venueName);
    else add("venue", "El parque coincide con lo que dijo el staff", "fail", `El staff indicó otro parque; el recibo es de ${gravity.venueName}`);
  }

  const paidSum = Math.round(gravity.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const paid = gravity.status === COMPLETED_STATUS && gravity.total > 0 && Math.abs(paidSum - gravity.total) < 0.02;
  add("paid", "Recibo completado y pagado", paid ? "ok" : "fail", paid ? `$${gravity.total} (${gravity.payments.map((p) => p.type).join(" + ")})` : `Estado ${gravity.status}, total $${gravity.total}, pagado $${paidSum}`);

  const lines = flamesLines(gravity);
  const distinct = new Set(lines.map((l) => l.name));
  if (!lines.length) add("flames_line", "El recibo tiene una línea de flames", "fail", "Ninguna línea de flames en el recibo");
  else add("flames_line", "El recibo tiene una línea de flames", "ok", lines.map((l) => `${l.name} × ${l.qty}`).join(" · "));
  if (distinct.size > 1) add("multi_flames", "Una sola línea de flames", "fail", `Hay ${distinct.size} líneas distintas`);
  else if (lines.length) add("multi_flames", "Una sola línea de flames", "ok");

  const cardQty = gravity.products.filter((p) => /^play\s*-?\s*card(?:\s*wristband)?$/i.test(p.name.trim())).reduce((s, p) => s + p.qty, 0);
  if (cardQty > 1) add("multi_card", "Una sola tarjeta en el recibo", "fail", `El recibo vende ${cardQty} tarjetas: los flames no se reparten`);
  else add("multi_card", "Una sola tarjeta en el recibo", "ok");

  const codes = gravity.gpCards.filter((c) => c.gpCardType === FLAMES_CARD_TYPE && /^\d{10}$/.test(c.code)).map((c) => c.code);
  if (!codes.length) add("card_on_receipt", "El recibo trae la Play Card (PLAY_CARD)", "fail", "No trae PLAY_CARD: no se puede validar la tarjeta");
  else add("card_on_receipt", "El recibo trae la Play Card (PLAY_CARD)", "ok", codes.join(", "));
  if (codes.length) {
    if (!chatCard) add("play_card", "La tarjeta del chat coincide con la del recibo (V2)", "warn", "Falta la tarjeta del chat para compararla");
    else if (codes.includes(chatCard)) add("play_card", "La tarjeta del chat coincide con la del recibo (V2)", "ok", chatCard);
    else add("play_card", "La tarjeta del chat coincide con la del recibo (V2)", "fail", `Chat: ${chatCard} · recibo: ${codes.join(", ")}`);
  }

  const failed = (ids) => out.checks.find((c) => ids.includes(c.id) && c.status === "fail");
  const b = failed(B_CHECKS);
  const esc = failed(ESCALATE_CHECKS);
  if (b) {
    out.verdict = "B";
    out.reason = b.id;
  } else if (esc) {
    out.verdict = "escalate";
    out.reason = esc.id;
  } else if (out.checks.some((c) => c.status === "warn")) {
    out.verdict = "pending"; // falta un dato del chat para decidir
  } else {
    out.verdict = "A";
  }

  const line = lines[0];
  out.facts = {
    venueId: gravity.venueId,
    venueName: gravity.venueName,
    flames: line?.total ?? null,
    amountUsd: line?.amount ?? null,
    cardCodes: codes,
    date: gravity.date,
    total: gravity.total,
  };
  return out;
}
