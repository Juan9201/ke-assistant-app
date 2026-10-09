/**
 * Visión (spec 003): foto del ticket → hallazgos con caja y confianza → "hechos" para el extractor.
 *
 * El OCR corre en Python (tools/vision-lab/ocr_read.py, RapidOCR local, sin red). Este módulo
 * solo arranca ese proceso y aplica las palabras clave de la KB (kb/data/vision-keywords.json).
 * La imagen nunca se guarda: llega por entrada estándar.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadParks, matchPark } from "./parks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR_SCRIPT = path.join(HERE, "..", "tools", "vision-lab", "ocr_read.py");
export const KEYWORDS_FILE = path.join(HERE, "..", "kb", "data", "vision-keywords.json");
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const OCR_TIMEOUT_MS = 60_000;

/** Reglas por defecto si la KB no tiene el archivo (copia de kb/data/vision-keywords.json; un test comprueba que no se desvíen). */
const DEFAULT_RULES = {
  "lowConfidenceBelow": 0.85,
  "rules": [
    {
      "kind": "receipt_label",
      "label": "Etiqueta Receipt Number",
      "color": "#ea580c",
      "pattern": "Receipt[A-Za-z]{0,2}N[uo]m?ber",
      "appliesTo": [
        "paper"
      ]
    },
    {
      "kind": "receipt_number",
      "label": "Receipt Number / Transaction #",
      "color": "#dc2626",
      "pattern": "^#?(\\d{8})$|#(\\d{8})|Number:?#?(\\d{8})"
    },
    {
      "kind": "flames_line",
      "label": "Línea de flames",
      "color": "#16a34a",
      "pattern": "\\$?(\\d+)=(\\d+)f[l1I]ames?(?:[xX×](\\d+))?"
    },
    {
      "kind": "arcade_amount",
      "label": "Total de flames (@Arcade)",
      "color": "#15803d",
      "pattern": "Arcadeamount:?(\\d+)",
      "appliesTo": [
        "paper"
      ]
    },
    {
      "kind": "wristband",
      "label": "Brazaletes / Play Card",
      "color": "#0891b2",
      "pattern": "Play-?card(?:Wristband)?[xX×](\\d+)",
      "appliesTo": [
        "paper"
      ]
    },
    {
      "kind": "play_card_field",
      "label": "Campo PLAY_CARD",
      "color": "#be185d",
      "pattern": "^PLAY_?CARD:?([\\d*]*)$",
      "appliesTo": [
        "screen"
      ]
    },
    {
      "kind": "punch_card_field",
      "label": "PUNCH_CARD (no es Play Card)",
      "color": "#9ca3af",
      "pattern": "^PUNCH_?CARD:?[\\d*]*$",
      "ignored": true,
      "appliesTo": [
        "screen"
      ]
    },
    {
      "kind": "paid_with",
      "label": "Forma de pago",
      "color": "#0f766e",
      "pattern": "Paid\\((.+?)\\)",
      "appliesTo": [
        "screen"
      ]
    },
    {
      "kind": "note",
      "label": "Nota",
      "color": "#a16207",
      "pattern": "^NOTE:?([A-Za-z0-9].*)$",
      "appliesTo": [
        "screen"
      ]
    },
    {
      "kind": "park_header",
      "label": "Parque",
      "color": "#2563eb",
      "pattern": "KidsEmpire|[A-Za-z]{1,2}-[A-Z][a-z]+|@kidsempire|POS\\d"
    },
    {
      "kind": "date",
      "label": "Fecha",
      "color": "#9333ea",
      "pattern": "(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?[A-Za-z0]+\\d{1,2},?\\d{4}|\\d{2}/\\d{2}/\\d{4}\\d{1,2}:\\d{2}[AP]M"
    },
    {
      "kind": "card_type_arcade",
      "label": "Tipo de tarjeta: Arcade",
      "color": "#0e7490",
      "pattern": "CardType:?Arcade",
      "appliesTo": [
        "paper"
      ]
    },
    {
      "kind": "play_card_last4",
      "label": "Play Card (últimos 4)",
      "color": "#be185d",
      "pattern": "CardNumber:?\\*+(\\d{4})",
      "appliesTo": [
        "paper"
      ]
    },
    {
      "kind": "payment_last4",
      "label": "Método de pago (se ignora)",
      "color": "#9ca3af",
      "pattern": "CardAccount:?[Xx*]+(\\d{4})",
      "ignored": true,
      "appliesTo": [
        "paper"
      ]
    }
  ]
};

export function loadKeywordRules(file = KEYWORDS_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(j.rules) && j.rules.length) return j;
  } catch {
    /* sin archivo en la KB: se usan las reglas por defecto */
  }
  return DEFAULT_RULES;
}

/* ------------------------------------------------------------------ */
/* OCR (proceso de Python)                                              */
/* ------------------------------------------------------------------ */

function pythonPath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Python", "Python312", "python.exe");
  return local && fs.existsSync(local) ? local : "python";
}

/** Ejecuta el OCR sobre los bytes de una imagen. Devuelve { width, height, ms, lines }. */
export function runOcr(buffer, { timeoutMs = OCR_TIMEOUT_MS, scale = 1 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return reject(new Error("Imagen vacía"));
    if (buffer.length > MAX_IMAGE_BYTES) return reject(new Error("La imagen es demasiado grande"));
    const child = spawn(pythonPath(), scale > 1 ? [OCR_SCRIPT, "--scale", String(scale)] : [OCR_SCRIPT], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("El OCR tardó demasiado"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`No se pudo iniciar Python: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`El OCR falló (${code}): ${err.trim().split("\n").pop() || "sin detalle"}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("El OCR devolvió una respuesta inválida"));
      }
    });
    child.stdin.end(buffer);
  });
}

/* ------------------------------------------------------------------ */
/* Hallazgos y hechos                                                   */
/* ------------------------------------------------------------------ */

const compact = (s) => String(s || "").replace(/\s+/g, "");
const boxOf = (poly) => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** Primera línea del mismo renglón (misma altura), a la derecha de `base`, cuyo texto sin espacios cumpla `test`. */
function rowMate(lines, base, test) {
  const [bx0, by0, , by1] = boxOf(base.box);
  const cy = (by0 + by1) / 2;
  const tol = Math.max(10, (by1 - by0) * 0.8);
  return (
    lines.find((l) => {
      if (l === base) return false;
      const b = boxOf(l.box);
      return b[0] > bx0 && Math.abs((b[1] + b[3]) / 2 - cy) <= tol && test(compact(l.text));
    }) || null
  );
}

/** Marcas de cada tipo de documento (sobre el texto de la línea sin espacios). */
const SCREEN_MARKERS = [/^Transaction#\d/i, /POSDevice/i, /^Cashier:?$/i, /Name\(s\)/i, /PrintReceipt/i, /^Refund$/i, /^Description$/i, /Qty.?Price/i, /^NOTE:/i];
const PAPER_MARKERS = [/Receipt[A-Za-z]{0,2}N[uo]m?ber/i, /ProductName/i, /^POS:/i, /Thankyou/i, /Pleaseretainreceipt/i, /TotalAmountPaid/i, /Visitagain/i, /Allsalesarefinal/i];

/**
 * ¿Ticket impreso ("paper"), foto de la pantalla de Gravity ("screen") o no identificado ("unknown")?
 * Gana el tipo con más marcas distintas (mínimo 2); si empatan o hay poco texto, "unknown" y se aplican todas las reglas.
 */
export function detectDocType(lines) {
  const texts = lines.map((l) => String(l.text || "").replace(/\s+/g, ""));
  const score = (markers) => markers.filter((m) => texts.some((t) => m.test(t))).length;
  const screen = score(SCREEN_MARKERS);
  const paper = score(PAPER_MARKERS);
  if (screen >= 2 && screen > paper) return "screen";
  if (paper >= 2 && paper > screen) return "paper";
  return "unknown";
}

/**
 * Convierte las líneas del OCR en hallazgos (con caja y confianza) y en "hechos" que usa el extractor.
 * Sirve para tickets de papel y para fotos de la pantalla de transacción de Gravity.
 * @param {{width:number,height:number,lines:{text:string,score:number,box:number[][]}[]}} ocr
 */
export function analyzeOcr(ocr, { rulesConfig = loadKeywordRules(), parks = loadParks() } = {}) {
  const low = rulesConfig.lowConfidenceBelow ?? 0.85;
  const lines = ocr.lines;
  const docType = detectDocType(lines);
  // Cada tipo usa sus reglas (un ticket de papel no se contamina con las de pantalla y al revés); si no se sabe, todas.
  const rules = rulesConfig.rules
    .filter((r) => !r.appliesTo || docType === "unknown" || r.appliesTo.includes(docType))
    .map((r) => ({ ...r, re: new RegExp(r.pattern, "i") }));
  const findings = [];

  lines.forEach((line, lineIndex) => {
    const text = compact(line.text);
    for (const r of rules) {
      const m = text.match(r.re);
      if (!m) continue;
      const value = m.slice(1).filter((g) => g !== undefined);
      findings.push({
        kind: r.kind,
        label: r.label,
        color: r.color,
        ignored: !!r.ignored,
        text: line.text,
        value: value.length === 1 ? value[0] : value.length ? value : null,
        score: line.score,
        box: boxOf(line.box),
        lowConfidence: line.score < low,
        lineIndex,
      });
      // Una línea cuenta para la primera regla que calza; la etiqueta "Receipt Number" convive con el número.
      if (r.kind !== "receipt_label") break;
    }
  });

  const of = (kind) => findings.filter((f) => f.kind === kind);
  const best = (list) => list.slice().sort((a, b) => b.score - a.score)[0] || null;
  const facts = { attempted: true, docType, lowConfidenceBelow: low };

  // Receipt Number (= Transaction # en la pantalla de Gravity): basta una lectura; dos números distintos son un conflicto.
  const receipts = of("receipt_number").filter((f) => /^\d{8}$/.test(String(f.value)));
  const distinct = [...new Set(receipts.map((f) => String(f.value)))];
  if (distinct.length === 1) {
    const f = best(receipts);
    facts.receiptNumber = distinct[0];
    facts.receiptScore = f.score;
    facts.receiptLowConfidence = f.lowConfidence;
  } else if (distinct.length > 1) {
    facts.receiptConflict = distinct;
  }
  // Candidatos corregidos: una línea de solo dígitos con 9 dígitos que empieza por un carácter de más (el "#" mal leído, "419420186").
  const fuzzy = [];
  lines.forEach((l, i) => {
    const t = compact(l.text);
    if (!/^[#\d:.,;'`~-]+$/.test(t)) return;
    const d = t.replace(/\D/g, "");
    if (/^\d19\d{6}$/.test(d)) fuzzy.push({ value: d.slice(1), score: l.score, lineIndex: i, corrected: true });
  });
  facts.receiptCandidates = [
    ...receipts.map((f) => ({ value: String(f.value), score: f.score, lineIndex: f.lineIndex, corrected: false })),
    ...fuzzy,
  ];
  if (!distinct.length && fuzzy.length) {
    const f = fuzzy.slice().sort((a, b) => b.score - a.score)[0];
    facts.receiptNumber = f.value;
    facts.receiptScore = f.score;
    facts.receiptLowConfidence = true; // lectura corregida: una persona la confirma
    facts.receiptCorrected = true;
    const rule = rules.find((r) => r.kind === "receipt_number");
    findings.push({ kind: "receipt_number", label: rule?.label || "Receipt Number", color: rule?.color || "#dc2626", ignored: false, text: lines[f.lineIndex].text, value: f.value, score: f.score, box: boxOf(lines[f.lineIndex].box), lowConfidence: true, lineIndex: f.lineIndex, corrected: true });
  }

  // Parque: encabezado, "POS Device", correo del cajero (ca-woodlandhills@kidsempire.us)... Todas las pistas deben coincidir.
  const parkHits = new Map(); // code -> { park, score }
  for (const f of of("park_header")) {
    const hit = matchPark(f.text, parks, { squash: true });
    if (hit.park) {
      f.value = hit.park.code;
      const prev = parkHits.get(hit.park.code);
      if (!prev || f.score > prev.score) parkHits.set(hit.park.code, { park: hit.park, score: f.score });
    }
  }
  // Una línea "park_header" que no resolvió a un parque era ruido (p. ej. un nombre con guion): no se muestra.
  for (let i = findings.length - 1; i >= 0; i--) if (findings[i].kind === "park_header" && !findings[i].value) findings.splice(i, 1);
  if (parkHits.size === 1) {
    const { park, score } = [...parkHits.values()][0];
    facts.parkKey = park.key;
    facts.parkCode = park.code;
    facts.parkScore = score;
    facts.parkLowConfidence = score < low;
  } else if (parkHits.size > 1) {
    facts.parkConflict = [...parkHits.keys()];
  }

  // Línea de flames: en el ticket de papel la cantidad va pegada ("x2"); en la pantalla va en otra columna ("1 $10.00").
  const flameLines = of("flames_line");
  if (flameLines.length) {
    const f = best(flameLines);
    let [unitAmount, flamesPerUnit, qty] = f.value.map(Number);
    let qtyAssumed = false;
    if (!qty) {
      const mate = rowMate(lines, lines[f.lineIndex], (t) => /^\d{1,2}\$\d/.test(t));
      qty = mate ? Number(compact(mate.text).match(/^(\d{1,2})\$/)[1]) : 1;
      qtyAssumed = !mate;
    }
    facts.flames = { unitAmount, flamesPerUnit, qty, qtyAssumed, multipleLines: flameLines.length > 1 };
    facts.flamesLowConfidence = f.lowConfidence;
  }
  const arcade = best(of("arcade_amount"));
  if (arcade) facts.arcadeAmount = Number(arcade.value);
  const wrist = best(of("wristband"));
  if (wrist) facts.wristbandQty = Number(wrist.value);

  // PLAY_CARD de la pantalla de Gravity: el valor va en el mismo renglón (10 dígitos, o enmascarado con los últimos 4).
  const pcField = best(of("play_card_field"));
  if (pcField) {
    const inline = String(pcField.value || "");
    const mate = /^[\d*]{4,12}$/.test(inline) ? { text: inline, score: pcField.score } : rowMate(lines, lines[pcField.lineIndex], (t) => /^[\d*]{4,12}$/.test(t));
    if (mate) {
      const v = compact(mate.text);
      if (/^\d{10}$/.test(v)) facts.playCardOnReceipt = v;
      else if (/\*\d{4}$/.test(v)) facts.playCardLast4 = v.slice(-4);
      pcField.value = v;
      pcField.score = Math.min(pcField.score, mate.score);
      pcField.lowConfidence = pcField.score < low;
    }
    facts.playCardFieldSeen = true;
  }
  if (of("punch_card_field").length) facts.punchCardPresent = true;

  // Últimos 4 de la Play Card: SOLO dentro del bloque "Card Type: Arcade". Los de "Card Account" son del pago.
  const last4 = best(of("play_card_last4"));
  if (last4 && of("card_type_arcade").length) facts.playCardLast4 = String(last4.value);
  const pay = best(of("payment_last4"));
  if (pay) facts.paymentLast4Ignored = String(pay.value);

  const paid = best(of("paid_with"));
  if (paid) {
    paid.value = (paid.text.match(/\((.+?)\)/) || [, paid.text])[1].trim();
    facts.paidWith = paid.value;
  }
  const note = best(of("note"));
  if (note) {
    note.value = note.text.replace(/^\s*NOTE:?\s*/i, "").trim();
    facts.note = note.value;
  }
  facts.hasTotals = lines.some((l) => /^Total:?$/i.test(compact(l.text)) || /^Paid\(/i.test(compact(l.text)));

  const dateF = best(of("date"));
  if (dateF) facts.dateText = dateF.text;

  // Qué no se encontró (para mostrarlo en el visor, spec R-07).
  const notFound = [];
  if (!facts.receiptNumber) notFound.push("receipt_number");
  if (!facts.parkCode) notFound.push("park_header");
  if (!dateF) notFound.push("date");
  if (!facts.flames) notFound.push("flames_line");

  return { docType, width: ocr.width, height: ocr.height, ms: ocr.ms, lines: lines.map((l) => ({ text: l.text, score: l.score, box: boxOf(l.box) })), findings, notFound, facts };
}

/** Ampliaciones del reintento para fotos chicas o dudosas (la miniatura del chat es de ~260 px). */
export const BOOST_SCALES = [3, 4];

/** ¿Vale la pena releer la foto ampliada? Foto chica o con el recibo/parque leídos con baja confianza. */
export function needsBoost(r) {
  const small = Math.max(r.width, r.height) < 900;
  return small || !!r.facts.receiptLowConfidence || !!r.facts.parkLowConfidence;
}

/**
 * Une la lectura normal con las ampliadas. El Receipt Number se decide por votación entre lecturas: gana el valor
 * que más lecturas repiten (y, a igualdad, el no corregido y el de más confianza). Solo se da por seguro si dos
 * lecturas coinciden con buena confianza; si no, queda marcado para que una persona lo confirme.
 */
export function mergePasses(base, passes) {
  const all = [base, ...passes];
  const facts = { ...base.facts };
  for (const p of passes) for (const [k, val] of Object.entries(p.facts)) if (facts[k] === undefined) facts[k] = val;
  const low = base.facts.lowConfidenceBelow ?? 0.85;

  // Receipt Number por votación
  const votes = new Map();
  all.forEach((p, i) => {
    for (const c of p.facts.receiptCandidates || []) {
      const e = votes.get(c.value) || { value: c.value, passes: new Set(), best: 0, exact: false, from: null };
      e.passes.add(i);
      if (c.score > e.best) {
        e.best = c.score;
        e.from = { pass: i, lineIndex: c.lineIndex };
      }
      if (!c.corrected) e.exact = true;
      votes.set(c.value, e);
    }
  });
  const ranked = [...votes.values()].sort((x, y) => y.passes.size - x.passes.size || Number(y.exact) - Number(x.exact) || y.best - x.best);
  delete facts.receiptConflict;
  delete facts.receiptNumber;
  if (ranked.length) {
    const top = ranked[0];
    const tie = ranked[1] && ranked[1].passes.size === top.passes.size && ranked[1].exact === top.exact && Math.abs(ranked[1].best - top.best) < 0.02;
    if (tie) {
      facts.receiptConflict = [top.value, ranked[1].value];
    } else {
      facts.receiptNumber = top.value;
      facts.receiptScore = top.best;
      facts.receiptVotes = top.passes.size;
      facts.receiptLowConfidence = !(top.passes.size >= 2 && top.exact && top.best >= low);
      facts.receiptCorrected = !top.exact;
    }
  }
  delete facts.receiptCandidates;

  // Hallazgos: los de la lectura normal; los de otras lecturas solo si faltan (las cajas ya vienen en coordenadas de la foto original)
  const findings = base.findings.filter((f) => f.kind !== "receipt_number" || (facts.receiptNumber && String(f.value) === facts.receiptNumber));
  for (let i = 1; i < all.length; i++) {
    for (const f of all[i].findings) {
      if (f.kind === "receipt_number") {
        if (facts.receiptNumber && String(f.value) === facts.receiptNumber && !findings.some((x) => x.kind === "receipt_number")) findings.push({ ...f, viaBoost: true, lowConfidence: facts.receiptLowConfidence });
      } else if (!findings.some((x) => x.kind === f.kind)) {
        findings.push({ ...f, viaBoost: true });
      }
    }
  }
  for (const f of findings) if (f.kind === "receipt_number") f.lowConfidence = !!facts.receiptLowConfidence;

  const notFound = [];
  if (!facts.receiptNumber) notFound.push("receipt_number");
  if (!facts.parkCode) notFound.push("park_header");
  if (!facts.dateText) notFound.push("date");
  if (!facts.flames) notFound.push("flames_line");
  facts.boosted = BOOST_SCALES.slice(0, passes.length);
  return { ...base, findings, notFound, facts, ms: all.reduce((s, p) => s + (p.ms || 0), 0) };
}

/** Foto → hallazgos. `ocr` se puede inyectar en pruebas. Si la foto es chica o dudosa, se relee ampliada y se vota. */
export async function readImage(buffer, { ocr = runOcr, boost = true, ...opts } = {}) {
  const base = analyzeOcr(await ocr(buffer), opts);
  if (!boost || !needsBoost(base)) return base;
  const passes = [];
  for (const scale of BOOST_SCALES) {
    try {
      passes.push(analyzeOcr(await ocr(buffer, { scale }), opts));
    } catch {
      /* si una ampliación falla, se sigue con lo que haya */
    }
  }
  return passes.length ? mergePasses(base, passes) : base;
}

/** Une los hallazgos de varias fotos de un mismo caso: lo primero definido manda; dos recibos distintos son conflicto. */
export function mergeVision(list) {
  const items = list.filter(Boolean);
  if (items.length <= 1) return items[0] || null;
  const facts = {};
  const receipts = new Set();
  for (const it of items) {
    if (it.facts.receiptNumber) receipts.add(it.facts.receiptNumber);
    for (const r of it.facts.receiptConflict || []) receipts.add(r);
    for (const [k, val] of Object.entries(it.facts)) if (facts[k] === undefined) facts[k] = val;
  }
  if (receipts.size > 1) {
    delete facts.receiptNumber;
    facts.receiptConflict = [...receipts];
  }
  return { ...items[0], facts, findings: items.flatMap((i) => i.findings), notFound: items[0].notFound.filter((k) => items.every((i) => i.notFound.includes(k))) };
}
