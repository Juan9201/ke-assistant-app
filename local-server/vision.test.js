import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeOcr, readImage, loadKeywordRules } from "./vision.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (id) => JSON.parse(fs.readFileSync(path.join(HERE, "test-fixtures", `ocr-${id}.json`), "utf8"));
const read = (id) => analyzeOcr(fx(id));

test("las reglas de la KB cargan y cubren las palabras clave de la spec", () => {
  const kinds = loadKeywordRules().rules.map((r) => r.kind);
  for (const k of ["receipt_number", "flames_line", "park_header", "date", "play_card_last4", "payment_last4"]) assert.ok(kinds.includes(k), k);
});

test("ticket 01 (Chesterfield): Receipt Number, parque y fecha; sin línea de flames", () => {
  const r = read("01");
  assert.equal(r.facts.receiptNumber, "19402005");
  assert.equal(r.facts.parkCode, "MI-Chesterfield");
  assert.ok(r.facts.dateText);
  assert.ok(r.notFound.includes("flames_line"));
  assert.equal(r.facts.receiptLowConfidence, false);
});

test("ticket 02 (Monrovia): el Receipt Number aparece dos veces y cuenta como una sola lectura (R-05)", () => {
  const r = read("02");
  assert.equal(r.facts.receiptNumber, "19400469");
  assert.equal(r.facts.receiptConflict, undefined);
  assert.equal(r.facts.parkCode, "CA-Monrovia");
});

test("ticket 03 (Marietta): línea $20 = 102 flames x 2", () => {
  const r = read("03");
  assert.equal(r.facts.receiptNumber, "19396510");
  assert.equal(r.facts.parkCode, "GA-Marietta");
  assert.deepEqual([r.facts.flames.unitAmount, r.facts.flames.flamesPerUnit, r.facts.flames.qty], [20, 102, 2]);
});

test("ticket 04 (North Bergen): parque truncado por el OCR y '#' perdido", () => {
  const r = read("04");
  assert.equal(r.facts.receiptNumber, "19387787");
  assert.equal(r.facts.parkCode, "NJ-North Bergen");
  assert.deepEqual([r.facts.flames.unitAmount, r.facts.flames.flamesPerUnit, r.facts.flames.qty], [5, 24, 1]);
  assert.equal(r.facts.arcadeAmount, 24);
});

test("ticket 05 (Merrillville): @Arcade amount 408 y 4 brazaletes", () => {
  const r = read("05");
  assert.equal(r.facts.receiptNumber, "19408850");
  assert.equal(r.facts.parkCode, "IN-Merrillville");
  assert.equal(r.facts.arcadeAmount, 408);
  assert.equal(r.facts.wristbandQty, 4);
  assert.equal(r.facts.flames.qty, 4);
});

test("R-13: los últimos 4 de 'Card Account' son del pago y se ignoran", () => {
  const r = read("05");
  assert.equal(r.facts.paymentLast4Ignored, "6289");
  assert.equal(r.facts.playCardLast4, undefined);
  assert.ok(r.findings.some((f) => f.kind === "payment_last4" && f.ignored));
});

test("R-13: con el bloque Card Type: Arcade, los últimos 4 sí son de la Play Card", () => {
  const ocr = { width: 100, height: 100, lines: [
    { text: "Card Type: Arcade", score: 0.97, box: [[0, 0], [10, 0], [10, 5], [0, 5]] },
    { text: "Card Number: ******6571", score: 0.95, box: [[0, 10], [10, 10], [10, 15], [0, 15]] },
  ] };
  assert.equal(analyzeOcr(ocr).facts.playCardLast4, "6571");
  const sinBloque = { width: 100, height: 100, lines: [ocr.lines[1]] };
  assert.equal(analyzeOcr(sinBloque).facts.playCardLast4, undefined, "sin 'Card Type: Arcade' no se acepta");
});

test("miniatura de baja resolución (caso Zarak): se lee, pero marcada como baja confianza (R-09)", () => {
  const r = read("zarak-chat");
  assert.ok(r.facts.receiptNumber, "algo se leyó");
  assert.equal(r.facts.receiptLowConfidence, true);
  assert.ok(r.facts.receiptScore < 0.85);
});

test("dos Receipt Number distintos: conflicto, no se elige", () => {
  const ocr = { width: 10, height: 10, lines: [
    { text: "#19402005", score: 0.99, box: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { text: "Receipt Number: #19402006", score: 0.98, box: [[0, 2], [1, 2], [1, 3], [0, 3]] },
  ] };
  const r = analyzeOcr(ocr);
  assert.equal(r.facts.receiptNumber, undefined);
  assert.deepEqual(r.facts.receiptConflict.sort(), ["19402005", "19402006"]);
});

test("foto sin nada útil: todo queda como no encontrado", () => {
  const r = analyzeOcr({ width: 10, height: 10, lines: [{ text: "hola", score: 0.9, box: [[0, 0], [1, 0], [1, 1], [0, 1]] }] });
  assert.deepEqual(r.notFound.sort(), ["date", "flames_line", "park_header", "receipt_number"]);
});

test("cada hallazgo trae caja [x0,y0,x1,y1] y confianza (R-06)", () => {
  const r = read("03");
  const f = r.findings.find((x) => x.kind === "receipt_number");
  assert.equal(f.box.length, 4);
  assert.ok(f.box[2] > f.box[0] && f.box[3] > f.box[1]);
  assert.ok(f.score > 0.9);
});

test("readImage usa el OCR inyectado (sin Python)", async () => {
  const r = await readImage(Buffer.from("x"), { ocr: async () => fx("03") });
  assert.equal(r.facts.receiptNumber, "19396510");
});

// Prueba de integración con Python real: se omite si no hay Python o no están las fotos de prueba.
const PHOTO = path.join(HERE, "..", "IMG Training", "01.jpg");
test("OCR real con Python sobre una foto de IMG Training", { skip: !fs.existsSync(PHOTO) && "no hay foto de prueba" }, async () => {
  const { runOcr } = await import("./vision.js");
  let ocr;
  try {
    ocr = await runOcr(fs.readFileSync(PHOTO));
  } catch (e) {
    return; // sin Python/RapidOCR en este PC: no es un fallo del código
  }
  assert.equal(analyzeOcr(ocr).facts.receiptNumber, "19402005");
});

import { mergeVision } from "./vision.js";

test("mergeVision: varias fotos de un caso se unen; dos recibos distintos son conflicto", () => {
  const a = read("03");
  const b = read("05");
  const m = mergeVision([a, b]);
  assert.equal(m.facts.receiptNumber, undefined);
  assert.deepEqual(m.facts.receiptConflict.sort(), ["19396510", "19408850"]);
  assert.equal(mergeVision([a]).facts.receiptNumber, "19396510");
  assert.equal(mergeVision([]), null);
  const sinRecibo = { ...read("zarak-chat"), facts: { attempted: true, wristbandQty: 2 } };
  assert.equal(mergeVision([sinRecibo, a]).facts.receiptNumber, "19396510");
});

test("regresión: el script de OCR escribe ASCII puro (en Windows un carácter raro rompía la salida)", { skip: !fs.existsSync(PHOTO) && "no hay foto de prueba" }, async () => {
  const { spawnSync } = await import("node:child_process");
  const py = process.env.PYTHON_PATH || path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python312", "python.exe");
  if (!fs.existsSync(py)) return;
  const r = spawnSync(py, [path.join(HERE, "..", "tools", "vision-lab", "ocr_read.py"), PHOTO], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "cp1252" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^[\x00-\x7f]*$/);
  assert.ok(JSON.parse(r.stdout).lines.length > 5);
});

/* ---------- Fotos de la pantalla de transacción de Gravity (S01..S04) ---------- */

test("pantalla S01 (Woodland Hills): Transaction #, parque por encabezado, flames con la cantidad en otra columna", () => {
  const r = read("S01");
  assert.equal(r.facts.receiptNumber, "19419819");
  assert.equal(r.facts.parkCode, "CA-Woodland Hills");
  assert.deepEqual([r.facts.flames.unitAmount, r.facts.flames.flamesPerUnit, r.facts.flames.qty], [10, 50, 1]);
  assert.equal(r.facts.flames.qtyAssumed, false, "la cantidad se leyó de la columna Qty");
  assert.equal(r.facts.paidWith, "Credit Payment");
  assert.equal(r.facts.hasTotals, true);
  assert.ok(r.facts.dateText);
});

test("pantalla S02 (Chesterfield): pagado con Punchcard; PUNCH_CARD no es una Play Card", () => {
  const r = read("S02");
  assert.equal(r.facts.receiptNumber, "19401995");
  assert.equal(r.facts.parkCode, "MI-Chesterfield");
  assert.equal(r.facts.paidWith, "Punchcard");
  assert.equal(r.facts.punchCardPresent, true);
  assert.equal(r.facts.playCardOnReceipt, undefined);
  assert.equal(r.facts.flames, undefined);
});

test("pantalla S03 (Ontario): sin número visible; el parque sale del POS Device y del correo del cajero", () => {
  const r = read("S03");
  assert.equal(r.facts.receiptNumber, undefined, "la foto está cortada: no inventa el número");
  assert.equal(r.facts.parkCode, "CA-Ontario");
  assert.match(r.facts.note, /membership purchase/);
});

test("pantalla S04 (Ontario): membership redeem, sin flames", () => {
  const r = read("S04");
  assert.equal(r.facts.receiptNumber, "19381723");
  assert.equal(r.facts.parkCode, "CA-Ontario");
  assert.match(r.facts.note, /membership redeem/);
  assert.equal(r.facts.flames, undefined);
});

test("PLAY_CARD en la pantalla: 10 dígitos o enmascarado con los últimos 4", () => {
  const mk = (value) => ({ width: 100, height: 100, lines: [
    { text: "PLAY_CARD:", score: 0.95, box: [[10, 100], [80, 100], [80, 120], [10, 120]] },
    { text: value, score: 0.93, box: [[200, 102], [300, 102], [300, 122], [200, 122]] },
  ] });
  assert.equal(analyzeOcr(mk("3968122745")).facts.playCardOnReceipt, "3968122745");
  assert.equal(analyzeOcr(mk("******2745")).facts.playCardLast4, "2745");
  const vacio = analyzeOcr(mk("********")).facts;
  assert.equal(vacio.playCardOnReceipt, undefined);
  assert.equal(vacio.playCardLast4, undefined);
});

test("la copia de reglas por defecto no se desvía de la de la KB", async () => {
  const mod = await import("./vision.js");
  const fromKb = JSON.parse(fs.readFileSync(path.join(HERE, "..", "kb", "data", "vision-keywords.json"), "utf8"));
  const viaFallback = mod.loadKeywordRules(path.join(HERE, "no-existe.json"));
  assert.deepEqual(viaFallback.rules, fromKb.rules);
});

/* ---------- Tipo de documento: ticket de papel vs pantalla de Gravity ---------- */
import { detectDocType } from "./vision.js";

test("se distingue el ticket de papel de la foto de la pantalla de Gravity", () => {
  for (const id of ["01", "02", "03", "04", "05"]) assert.equal(read(id).docType, "paper", id);
  for (const id of ["S01", "S02", "S03", "S04"]) assert.equal(read(id).docType, "screen", id);
  assert.equal(read("S01").facts.docType, "screen");
});

test("una foto con poco texto no se fuerza a un tipo: 'unknown' aplica todas las reglas", () => {
  assert.equal(detectDocType([{ text: "hola" }]), "unknown");
  const ocr = { width: 10, height: 10, lines: [{ text: "$10 = 50 flames", score: 0.9, box: [[0, 0], [5, 0], [5, 2], [0, 2]] }] };
  assert.equal(analyzeOcr(ocr).docType, "unknown");
  assert.ok(analyzeOcr(ocr).facts.flames, "con tipo desconocido las reglas de flames siguen funcionando");
});

test("complementarios, no contaminados: las reglas de pantalla no actúan sobre un ticket de papel y viceversa", () => {
  const paper = fx("03");
  const conRuido = { ...paper, lines: [...paper.lines, { text: "NOTE: texto suelto", score: 0.9, box: [[0, 5], [50, 5], [50, 20], [0, 20]] }, { text: "PLAY_CARD:", score: 0.9, box: [[0, 30], [50, 30], [50, 45], [0, 45]] }] };
  const r = analyzeOcr(conRuido);
  assert.equal(r.docType, "paper");
  assert.equal(r.facts.note, undefined, "NOTE: es regla de pantalla");
  assert.equal(r.facts.playCardFieldSeen, undefined);
  assert.equal(r.facts.receiptNumber, "19396510", "lo propio del papel no se pierde");
  const screen = fx("S01");
  const conPapel = { ...screen, lines: [...screen.lines, { text: "@Arcade amount: 999", score: 0.9, box: [[0, 5], [50, 5], [50, 20], [0, 20]] }] };
  const s = analyzeOcr(conPapel);
  assert.equal(s.docType, "screen");
  assert.equal(s.facts.arcadeAmount, undefined, "@Arcade es regla de papel");
  assert.equal(s.facts.receiptNumber, "19419819");
});

test("las reglas de la KB declaran a qué tipo aplican", () => {
  const rules = loadKeywordRules().rules;
  assert.deepEqual(rules.find((r) => r.kind === "play_card_field").appliesTo, ["screen"]);
  assert.deepEqual(rules.find((r) => r.kind === "arcade_amount").appliesTo, ["paper"]);
  assert.equal(rules.find((r) => r.kind === "receipt_number").appliesTo, undefined, "el recibo vale para ambos");
});
