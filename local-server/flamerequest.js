/**
 * Entendimiento de pedidos de flames (spec 002). Determinista y sin red: la IA no interviene.
 *
 * Recibe el texto del chat y devuelve qué entendió, el protocolo que corresponde, los datos
 * capturados, lo que falta, la respuesta en inglés (pregunta o escalación, siempre con el nombre
 * de quien escribió) y si el botón verde puede habilitarse. Las guardas viven aquí (código),
 * no en el prompt (constitución, principio 3).
 *
 * Reglas: kb/docs/business-logic/playcard.md (extracción, "Aclaraciones de Juan 2026-10-08").
 *
 * Protocolos (los elige el contenido del mensaje, no un selector):
 *   test_card    — dice "test" + "card": $10 = 50 flames fijos, sin recibo ni Gravity.
 *   receipt      — el normal: valida el recibo en Gravity antes del botón verde.
 *   out_of_scope — reembolso o tarjeta dañada/que no escanea: se escala.
 */

import { CAPS } from "./jobs.js";
import { loadParks, matchPark } from "./parks.js";
import { evaluateGravity } from "./gravity.js";

export const PROTOCOLS = ["test_card", "receipt", "out_of_scope"];

// Versión de la forma de la respuesta (el userscript la compara). Súbela cuando cambie esa forma.
// 1 = steps como lista y `question` (T-03) · 2 = steps {read, execute}, `reply`, `protocol` (T-04/T-05)
export const ANALYSIS_CONTRACT = 2;
export const TEST_CARD_FLAMES = 50;
export const TEST_CARD_AMOUNT_USD = 10;

// Frases literales de la KB (playcard.md → "Respuestas al staff").
const Q_PARK = "May I know in which park are you located, please?";
const Q_RECEIPT = "Could you please share the Receipt ID (Transaction #) of the purchase?";
const Q_CARD = "Could you please share the play card number (10 digits)?";
const qLength = (n, missing) =>
  `Sorry... But would it be possible to double check the sequence number? It looks like it ${
    missing ? `is missing ${n}` : `has ${n} extra`
  } digit(s). Please?`;

const fold = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .toLowerCase();

const TOPIC = /play\s*-?\s*card|playcard|\bflames?\b|\bcard\b[^.]{0,60}\b(?:load|reload|balance|credit)/;
const REFUND = /\brefund|money back|chargeback|\bvoid\b/;
const DAMAGED = /\b(?:bent|broken|cracked|damaged|snapped)\b|\b(?:won't|wont|doesn't|doesnt|can't|cant|isn't|not|will not)\s+(?:be\s+)?scan/;
const PHONE_CTX = /phone|call|contact|\btel\b|cell|mobile/;

function findCard(t) {
  const valid = [];
  const bad = [];
  for (const m of t.matchAll(/(?<!\d)(?:\d[\s-]?){9}\d(?!\d)/g)) {
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    const hasWord = /card/.test(before);
    if (PHONE_CTX.test(before) && !hasWord) continue; // teléfono, no tarjeta
    const digits = m[0].replace(/\D/g, "");
    if (!valid.some((v) => v.digits === digits)) valid.push({ digits, hasWord });
  }
  for (const m of t.matchAll(/(?<!\d)(?:\d{9}|\d{11,12})(?!\d)/g)) {
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    if (/card/.test(before)) bad.push(m[0]);
  }
  return { valid, bad };
}

function findReceipt(t) {
  const m =
    t.match(/(?:receipt|transaction)\s*(?:id|number|no\.?)?\s*[:#]?\s*#?\s*(\d{6,9})(?!\d)/) ||
    t.match(/#\s?(\d{6,9})(?!\d)/);
  return m ? m[1] : null;
}

// Referencia de la KB (playcard.md): monto pagado → flames. Es una lista, no una fórmula; Gravity manda sobre ella.
export const FLAMES_BY_AMOUNT = { 5: 24, 10: 50, 20: 102, 25: 125, 50: 250 };

function findFlames(t) {
  // Un número pegado a "$" es un MONTO ("$10 flame play card"), no una cantidad de flames.
  const m = t.match(/(?<![\d$])(\d{1,4})\s*flames?\b/) || t.match(/flames?\s*[:=x]?\s*(\d{1,4})\b/);
  return m ? Number(m[1]) : null;
}

function findAmount(t) {
  const m = t.match(/\$\s*(\d{1,3}(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

const joinList = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

function pendingFor(protocol, { gravityDone = false } = {}) {
  if (protocol === "test_card") return ["Comprobar que nadie atendió ya este pedido (chat y cardScanReports) — pendiente de implementar"];
  const items = [];
  if (!gravityDone) items.push("Lectura del recibo en Gravity (Transaction #, PLAY_CARD, flames, pago)");
  items.push("Revisión del historial de la tarjeta en Amusement — pendiente de implementar");
  return items;
}

function stepsFor(protocol, f) {
  const park = f.parkName || "—";
  const loc = f.locationId ? ` (locationId ${f.locationId})` : "";
  const kiosk = [
    `Abrir Manual Kiosk de ${park}${loc}`,
    `Pegar la tarjeta ${f.card || "—"}`,
    `Teclear $${f.amountUsd ?? "—"} y comprobar que Credits Loaded per Card = ${f.flames ?? "los flames del recibo"} (si no coincide, se detiene)`,
    "Pulsar Credit",
    "Verificar el mensaje de éxito y la nueva entrada en el historial de la tarjeta",
    "Proponer la respuesta en inglés al autor del pedido",
  ];
  if (protocol === "test_card") {
    return {
      read: ["Comprobar en el chat que nadie atendió este pedido", "Amusement: revisar cardScanReports de la tarjeta (¿ya la cargaron?)"],
      execute: kiosk,
    };
  }
  return {
    read: [
      `Gravity: abrir ${park} → Reports → pos-transaction`,
      `Seleccionar la fecha del recibo y pegar el Receipt Number ${f.receiptNumber ? `#${f.receiptNumber}` : "—"}`,
      "Comprobar que Transaction # = Receipt Number; leer estado de pago, PLAY_CARD y línea de flames",
      "Comparar PLAY_CARD con la tarjeta del chat (V2)",
      "Amusement: revisar el historial de la tarjeta (¿ya tiene esos flames?)",
    ],
    execute: kiosk,
  };
}

/**
 * @param {{text:string, author?:string, greetingName?:string, overrides?:{parkKey?:string, card?:string, receiptNumber?:string, flames?:number, amountUsd?:number}}} input
 */
export function analyzeFlameRequest({ text = "", author = "", greetingName = "", overrides = {}, parks = loadParks(), vision = null, gravity: gravityIn = null } = {}) {
  const t = fold(text);
  const requester = String(author || "").trim();
  const greet = greetingName ? `Hello ${greetingName},` : "Hello,";
  const empty = { read: [], execute: [] };

  const base = { requester, fields: {}, missing: [], blockers: [], warnings: [], pendingChecks: [], reply: null, replyKind: null, dataReady: false, canApprove: false, steps: empty };

  // --- Clasificación (la decide el contenido del mensaje)
  if (REFUND.test(t) && (TOPIC.test(t) || /\bcard\b/.test(t))) {
    return { ...base, isFlameRequest: true, protocol: "out_of_scope", understood: "Pide un reembolso o anulación: es R2 y siempre se escala.", reply: `${greet} allow me take a look, thank you!`, replyKind: "escalation" };
  }
  if (DAMAGED.test(t) && /card/.test(t)) {
    return { ...base, isFlameRequest: true, protocol: "out_of_scope", understood: "Habla de una tarjeta dañada o que no escanea: no es un pedido de flames, se escala.", reply: `${greet} allow me take a look, thank you!`, replyKind: "escalation" };
  }
  const isTest = /\btest\b/.test(t) && /\bcard\b/.test(t);
  if (!isTest && !TOPIC.test(t)) {
    return { ...base, isFlameRequest: false, protocol: null, understood: "" };
  }
  const protocol = isTest ? "test_card" : "receipt";
  const vf = vision?.facts || {};

  // Un ticket con varios brazaletes es de varias tarjetas: los flames no se reparten, se escala (regla de Juan).
  if (protocol === "receipt" && vf.wristbandQty > 1) {
    return { ...base, isFlameRequest: true, protocol: "out_of_scope", understood: `El ticket trae ${vf.wristbandQty} tarjetas (brazaletes): los flames no se reparten entre tarjetas; se escala.`, reply: `${greet} allow me take a look, thank you!`, replyKind: "escalation" };
  }

  // Un recibo completo sin línea de flames NO se descarta: Gravity decide (regla de Juan, 2026-10-09).
  //   Caso A: Gravity sí tiene los flames y falló la carga en Amusement → solución.
  //   Caso B: el staff dio un recibo o una tarjeta equivocados → pedir que lo rectifique.
  // Aquí solo se avisa; el veredicto lo da la lectura en Gravity.
  const warnings = [];
  if (protocol === "receipt" && vf.hasTotals && !vf.flames && vf.arcadeAmount == null) {
    const nota = vf.note ? ` (nota: ${vf.note})` : "";
    const pago = vf.paidWith ? `, pagado con ${vf.paidWith}` : "";
    warnings.push(`La foto es un recibo completo${pago}${nota} y no muestra una línea de flames: Gravity confirmará si es el recibo correcto (caso A: falló Gravity→Amusement; caso B: recibo o tarjeta equivocados).`);
  }

  // --- Parque (del texto; si no está, de la foto)
  const detected = overrides.parkKey ? { park: null } : matchPark(text, parks);
  const visionPark = vf.parkKey ? parks.find((p) => p.key === vf.parkKey) || null : null;
  let park = overrides.parkKey ? parks.find((p) => p.key === overrides.parkKey) || null : detected.park || visionPark;
  const parkSource = overrides.parkKey ? "corregido" : detected.park ? "texto" : visionPark ? "foto" : null;

  // --- Tarjeta
  let card = null;
  let cardConfirmed = false;
  let cardIssue = null; // "length" | "ambiguous" | "unconfirmed"
  let badLength = null;
  let options = [];
  if (overrides.card !== undefined && String(overrides.card).trim() !== "") {
    const digits = String(overrides.card).replace(/[\s-]/g, "");
    if (/^\d{10}$/.test(digits)) {
      card = digits;
      cardConfirmed = true; // la corrigió o confirmó una persona
    } else {
      cardIssue = "length";
      badLength = digits.length;
    }
  } else {
    const { valid, bad } = findCard(t);
    if (valid.length > 1) {
      cardIssue = "ambiguous";
      options = valid.map((v) => v.digits);
    } else if (valid.length === 1) {
      card = valid[0].digits;
      cardConfirmed = valid[0].hasWord;
      if (!cardConfirmed) cardIssue = "unconfirmed";
    } else if (bad.length) {
      cardIssue = "length";
      badLength = bad[0].length;
    }
  }

  // --- Receipt Number (solo protocolo con recibo)
  let receiptNumber = null;
  let receiptSource = null; // "texto" | "foto" | "corregido"
  let receiptConfirmed = false;
  if (protocol === "receipt") {
    if (overrides.receiptNumber !== undefined && String(overrides.receiptNumber).trim() !== "") {
      const d = String(overrides.receiptNumber).replace(/^#/, "").trim();
      receiptNumber = /^\d{6,9}$/.test(d) ? d : null;
      receiptSource = "corregido";
      receiptConfirmed = !!receiptNumber; // la corrigió o confirmó una persona
    } else if ((receiptNumber = findReceipt(t))) {
      receiptSource = "texto";
      receiptConfirmed = true;
    } else if (vf.receiptNumber) {
      receiptNumber = vf.receiptNumber;
      receiptSource = "foto";
      receiptConfirmed = !vf.receiptLowConfidence; // baja confianza: una persona debe confirmarlo
    }
  }
  const receiptConflict = protocol === "receipt" && !receiptNumber && vf.receiptConflict ? vf.receiptConflict : null;

  // --- Flames y monto
  let flames;
  let amountUsd;
  let flamesSource = null;
  if (protocol === "test_card") {
    flames = TEST_CARD_FLAMES; // regla fija: siempre $10 = 50 flames
    amountUsd = TEST_CARD_AMOUNT_USD;
  } else {
    flames = overrides.flames ?? findFlames(t);
    amountUsd = overrides.amountUsd ?? findAmount(t);
    // Si el texto no lo dice, se toma de la línea del ticket: total impreso (@Arcade) o flames por cantidad.
    if (flames == null && vf.flames) {
      flames = vf.arcadeAmount ?? vf.flames.flamesPerUnit * vf.flames.qty;
      flamesSource = "foto";
    }
    if (amountUsd == null && vf.flames) amountUsd = vf.flames.unitAmount * vf.flames.qty;
    // Si solo se sabe el monto ("$10 flame play card"), los flames salen de la lista de la KB (referencia; Gravity lo confirma).
    if (flames == null && amountUsd != null && FLAMES_BY_AMOUNT[amountUsd] != null) {
      flames = FLAMES_BY_AMOUNT[amountUsd];
      flamesSource = "lista";
    }
  }
  const reason = protocol === "test_card" ? "test_card" : "webhook_failed";

  const fields = {
    parkKey: park?.key || null,
    parkName: park?.name || null,
    parkCode: park?.code || null,
    gravityVenueId: park?.gravityVenueId ?? null,
    locationId: park?.locationId ?? null,
    organizationId: park?.organizationId ?? null,
    parkSource,
    card,
    cardConfirmed,
    receiptNumber,
    receiptSource,
    receiptConfirmed,
    flamesSource,
    flames: Number.isInteger(flames) ? flames : null,
    amountUsd: typeof amountUsd === "number" && Number.isFinite(amountUsd) ? amountUsd : null,
    reason,
  };

  // --- Lectura en Gravity (T-07): el veredicto A/B lo da Gravity, no la foto ni el texto
  // Una lectura guardada de otro Receipt Number (p. ej. antes de corregirlo) ya no vale.
  const gravity = gravityIn && (!gravityIn.requestedReceipt || gravityIn.requestedReceipt === receiptNumber) ? gravityIn : null;
  let evidence = [];
  let verdict = "pending";
  let gravityReason = null;
  if (protocol === "receipt" && gravity) {
    const expectedVenueId = parkSource === "texto" || parkSource === "corregido" ? fields.gravityVenueId : null;
    const ev = evaluateGravity({ gravity, chatCard: card, expectedVenueId });
    evidence = ev.checks;
    verdict = ev.verdict;
    gravityReason = ev.reason;
    if (gravity.found) {
      // El parque, los flames y el monto del recibo mandan sobre lo leído de la foto o del texto.
      const gp = parks.find((p) => p.gravityVenueId === gravity.venueId);
      if (gp && verdict !== "B") {
        park = gp;
        Object.assign(fields, { parkKey: gp.key, parkName: gp.name, parkCode: gp.code, gravityVenueId: gp.gravityVenueId, locationId: gp.locationId ?? null, organizationId: gp.organizationId ?? null, parkSource: "gravity" });
      }
      if (ev.facts.flames != null && overrides.flames == null) {
        fields.flames = ev.facts.flames;
        fields.flamesSource = "gravity";
      }
      if (ev.facts.amountUsd != null && overrides.amountUsd == null) fields.amountUsd = ev.facts.amountUsd;
      // Un Receipt Number leído de la foto con baja confianza queda confirmado si Gravity lo encontró y es del parque que dijo el staff.
      if (fields.receiptSource === "foto" && !fields.receiptConfirmed && expectedVenueId === gravity.venueId) {
        fields.receiptConfirmed = true;
        fields.receiptSource = "foto+gravity";
        receiptConfirmed = true;
      }
    }
  }
  const GRAVITY_REASONS = {
    receipt_not_found: "Gravity no encontró ese Receipt Number",
    venue: "El recibo es de otro parque que el que dijo el staff",
    flames_line: "El recibo de Gravity no tiene línea de flames",
    play_card: "La tarjeta del chat no coincide con la del recibo en Gravity",
    paid: "El recibo no está completado y pagado en Gravity",
    multi_flames: "El recibo tiene varias líneas de flames",
    multi_card: "El recibo vende varias tarjetas: los flames no se reparten",
    card_on_receipt: "El recibo de Gravity no trae PLAY_CARD: no se puede validar la tarjeta",
  };

  // --- Faltantes y bloqueos de datos (las lecturas de Gravity/Amusement van aparte, en pendingChecks)
  const missing = [];
  const blockers = [];
  if (!park) {
    missing.push("park");
    blockers.push("Falta el parque");
  } else if (park.locationId == null) {
    blockers.push(`Sin locationId de Amusement para ${park.code} (revisar kb/data/parks.json)`);
  }
  if (!card) {
    missing.push("card");
    blockers.push(
      cardIssue === "length" ? "La tarjeta debe tener exactamente 10 dígitos"
        : cardIssue === "ambiguous" ? "Hay varios números posibles: ¿cuál es la tarjeta?"
        : "Falta la tarjeta",
    );
  } else if (!cardConfirmed) {
    blockers.push("Tarjeta sin confirmar (el número no iba junto a 'play card'); corrígela o confírmala");
  }
  if (protocol === "receipt" && !receiptNumber) {
    missing.push("receipt");
    blockers.push(receiptConflict ? `La foto tiene dos Receipt Number distintos (${receiptConflict.join(" y ")})` : "Falta el Receipt Number");
  } else if (receiptNumber && !receiptConfirmed) {
    const pct = Math.round((vf.receiptScore || 0) * 100);
    blockers.push(`Receipt Number leído de la foto con baja confianza (${pct}%): confírmalo o corrígelo mirando la foto`);
  }

  // V2 parcial con la foto: los últimos 4 del bloque "Card Type: Arcade" deben coincidir con la tarjeta del chat.
  // Si la pantalla del recibo muestra el PLAY_CARD completo se compara entero; si solo trae los últimos 4, esos.
  const fullMismatch = !!(card && vf.playCardOnReceipt && card !== vf.playCardOnReceipt);
  const last4Mismatch = fullMismatch || !!(card && !vf.playCardOnReceipt && vf.playCardLast4 && card.slice(-4) !== vf.playCardLast4);
  if (fullMismatch) blockers.push(`La Play Card del recibo (${vf.playCardOnReceipt}) no coincide con la tarjeta del chat (${card})`);
  else if (last4Mismatch) blockers.push(`Los últimos 4 de la Play Card del ticket (${vf.playCardLast4}) no coinciden con la tarjeta del chat (…${card.slice(-4)})`);

  // Datos de la línea de flames leídos de la foto con poca seguridad: una persona los confirma (no se le pregunta al staff).
  if (flamesSource === "foto" && vf.flames) {
    if (vf.flames.qtyAssumed) blockers.push("No pude leer la cantidad (Qty) de la línea de flames de la foto: verifica los flames");
    else if (vf.flamesLowConfidence) blockers.push("La línea de flames de la foto se leyó con baja confianza: verifica los flames");
  }
  if (protocol === "receipt") {
    if (fields.flames != null && fields.flames > CAPS[reason]) blockers.push(`Supera el tope de ${CAPS[reason]} flames para ${reason}`);
    if (fields.amountUsd != null && (!(fields.amountUsd > 0) || fields.amountUsd > 999)) blockers.push("Monto en dólares inválido (0 a 999)");
  }

  if (verdict === "B" || verdict === "escalate") blockers.push(`Gravity: ${GRAVITY_REASONS[gravityReason] || gravityReason}`);

  // --- Respuesta en inglés: pregunta con las frases de la KB, siempre nombrando a la persona
  const sentences = [];
  if (missing.includes("park")) sentences.push(Q_PARK);
  if (missing.includes("card") && !cardIssue) sentences.push(Q_CARD);
  if (cardIssue === "length") sentences.push(qLength(Math.abs(10 - badLength), badLength < 10));
  if (cardIssue === "ambiguous") sentences.push(`Which of these numbers is the play card: ${options.join(" or ")}?`);
  if (cardIssue === "unconfirmed") sentences.push(`Could you please confirm that ${card} is the play card number?`);
  if (missing.includes("receipt")) {
    if (receiptConflict) sentences.push(`Could you please confirm which one is the Receipt ID: ${receiptConflict.join(" or ")}?`);
    else {
      sentences.push(Q_RECEIPT);
      if (vision?.facts?.attempted) sentences.push("The photo is hard to read, could you please send a clearer one?");
    }
  }
  let reply = sentences.length ? `${greet} ${sentences.join(" ")}` : null;
  let replyKind = reply ? "question" : null;
  if (last4Mismatch) {
    reply = `${greet} It looks like the play card and receipt info doesn't match, feel free to find the correct play card or receipt, thank you!`;
    replyKind = "mismatch";
  }
  // Veredicto de Gravity: B = el staff se equivocó (pedir rectificar, R-V2); escalar = fuera de lo previsto.
  if (verdict === "B") {
    reply = `${greet} It looks like the play card and receipt info doesn't match, feel free to find the correct play card or receipt, thank you!`;
    replyKind = "mismatch";
  } else if (verdict === "escalate") {
    reply = `${greet} allow me take a look, thank you!`;
    replyKind = "escalation";
  }

  const understood =
    `${protocol === "test_card" ? "Pide cargar una tarjeta de prueba (test card)" : "Reporta un problema de flames"}` +
    `${fields.parkName ? ` en ${fields.parkName}` : ""}` +
    `${card ? `, tarjeta ${card}` : ""}` +
    `${receiptNumber ? `, recibo #${receiptNumber}` : ""}` +
    `${protocol === "test_card" ? ` ($${TEST_CARD_AMOUNT_USD} = ${TEST_CARD_FLAMES} flames, sin recibo)` : fields.flames ? `, ${fields.flames} flames` : ""}.`;

  const dataReady = blockers.length === 0;
  const pendingChecks = dataReady ? pendingFor(protocol, { gravityDone: !!gravity && gravity.found !== undefined }) : [];

  return {
    isFlameRequest: true,
    protocol,
    understood,
    requester,
    fields,
    missing,
    blockers,
    warnings,
    pendingChecks,
    reply,
    replyKind,
    dataReady,
    verdict, // "pending" | "A" | "B" | "escalate" (lo decide Gravity)
    evidence, // validaciones de Gravity con su resultado, para mostrarlas en el panel
    // El verde exige datos completos, TODAS las lecturas hechas y el veredicto A (ADR-002).
    canApprove: dataReady && pendingChecks.length === 0 && (protocol !== "receipt" || verdict === "A"),
    steps: stepsFor(protocol, fields),
  };
}
