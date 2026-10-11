import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFlameRequest } from "./flamerequest.js";
import { buildParks } from "./parks.js";

const A = (text, extra = {}) =>
  analyzeFlameRequest({ text, author: "AM Rashel Carswell", greetingName: "Rashel", ...extra });

/* ---------- Protocolo con recibo (el normal) ---------- */

test("recibo · mensaje completo: captura todo; el verde espera la lectura de Gravity", () => {
  const r = A("Guest paid for flames, play card 3968122745 at Arlington, receipt #19402005");
  assert.equal(r.isFlameRequest, true);
  assert.equal(r.protocol, "receipt");
  assert.equal(r.fields.card, "3968122745");
  assert.equal(r.fields.cardConfirmed, true);
  assert.equal(r.fields.parkName, "Arlington");
  assert.equal(r.fields.locationId, 4809);
  assert.equal(r.fields.receiptNumber, "19402005");
  assert.equal(r.requester, "AM Rashel Carswell");
  assert.equal(r.reply, null);
  assert.equal(r.dataReady, true);
  assert.equal(r.canApprove, false, "aún no existe la lectura de Gravity: el verde no puede habilitarse");
  assert.ok(r.pendingChecks.length >= 1);
  assert.match(r.steps.read[0], /Gravity/);
  assert.ok(r.steps.execute.length >= 3);
  assert.ok(r.understood.length > 10);
});

test("recibo · sin tarjeta: pregunta con la frase de la KB y con el nombre", () => {
  const r = A("Playcard not loading flames at Chandler, receipt 19402005");
  assert.equal(r.protocol, "receipt");
  assert.equal(r.fields.card, null);
  assert.ok(r.missing.includes("card"));
  assert.equal(r.replyKind, "question");
  assert.match(r.reply, /^Hello Rashel, /);
  assert.match(r.reply, /Could you please share the play card number \(10 digits\)\?/);
  assert.equal(r.dataReady, false);
});

test("recibo · sin Receipt Number: lo pide con la frase de la KB", () => {
  const r = A("play card 3968122745 no flames at Arlington");
  assert.ok(r.missing.includes("receipt"));
  assert.match(r.reply, /Could you please share the Receipt ID \(Transaction #\) of the purchase\?/);
  assert.equal(r.dataReady, false);
});

test("recibo · sin parque: lo pide con la frase de la KB", () => {
  const r = A("play card 3968122745 no flames, receipt 19402005");
  assert.ok(r.missing.includes("park"));
  assert.match(r.reply, /May I know in which park are you located, please\?/);
});

test("recibo · faltan varios datos: una sola respuesta con el nombre una vez", () => {
  const r = A("flames missing on a play card");
  assert.deepEqual(r.missing.sort(), ["card", "park", "receipt"]);
  assert.equal(r.reply.match(/Hello Rashel,/g).length, 1);
});

test("V1 · tarjeta con un dígito menos o de más usa la frase de la KB con el conteo", () => {
  const menos = A("play card 396812274 has no flames, Arlington, receipt 19402005");
  assert.equal(menos.fields.card, null);
  assert.match(menos.reply, /double check the sequence number\? It looks like it is missing 1 digit\(s\)/);
  const mas = A("play card 39681227455 has no flames, Arlington, receipt 19402005");
  assert.match(mas.reply, /It looks like it has 1 extra digit\(s\)/);
  assert.equal(mas.dataReady, false);
});

test("un número de 10 dígitos presentado como teléfono no es tarjeta", () => {
  const r = A("flames missing at Arlington receipt 19402005, guest phone 4805551234");
  assert.equal(r.fields.card, null);
  assert.ok(r.missing.includes("card"));
});

test("número de 10 dígitos sin la palabra 'card': pide confirmarlo", () => {
  const r = A("no flames loaded at Arlington 3968122745 receipt 19402005");
  assert.equal(r.fields.card, "3968122745");
  assert.equal(r.fields.cardConfirmed, false);
  assert.match(r.reply, /confirm that 3968122745 is the play card number/);
  assert.equal(r.dataReady, false);
});

test("varios candidatos: pregunta cuál es la tarjeta", () => {
  const r = A("flames missing, play card 3968122745 or 1234567890 at Arlington receipt 19402005");
  assert.equal(r.fields.card, null);
  assert.match(r.reply, /Which of these numbers is the play card/);
});

test("tarjeta con espacios o guiones se normaliza", () => {
  const r = A("play card 396-812-2745 at Arlington receipt 19402005");
  assert.equal(r.fields.card, "3968122745");
});

test("Receipt Number: con '#', con 'receipt' o con 'Transaction #'", () => {
  assert.equal(A("play card 3968122745 Arlington #19408850").fields.receiptNumber, "19408850");
  assert.equal(A("play card 3968122745 Arlington Receipt Number: 19408850").fields.receiptNumber, "19408850");
  assert.equal(A("play card 3968122745 Arlington Transaction #19408850").fields.receiptNumber, "19408850");
});

test("corregir campos (overrides) re-evalúa y confirma", () => {
  const first = A("Playcard no flames at Chandler");
  assert.equal(first.dataReady, false);
  const r = A("Playcard no flames at Chandler", { overrides: { card: "0800450398", receiptNumber: "19402005" } });
  assert.equal(r.fields.card, "0800450398");
  assert.equal(r.fields.cardConfirmed, true);
  assert.equal(r.fields.receiptNumber, "19402005");
  assert.equal(r.dataReady, true);
  assert.equal(r.reply, null);
});

test("override con tarjeta de largo incorrecto sigue bloqueando", () => {
  const r = A("Playcard no flames at Chandler", { overrides: { card: "12345", receiptNumber: "19402005" } });
  assert.equal(r.dataReady, false);
  assert.match(r.reply, /missing 5 digit\(s\)/);
});

test("directorio de parques: nombre → venue de Gravity y locationId de Amusement", () => {
  const casos = [
    ["Chandler", "AZ-Chandler", 194, 2364],
    ["Arlington", "TX-Arlington", 225, 4809],
    ["Marietta", "GA-Marietta", 31, 1097],
    ["Merrillville", "IN-Merrillville", 159, 1471],
    ["Monrovia", "CA-Monrovia", 6, 1090],
    ["North Bergen", "NJ-North Bergen", 217, 4515],
    ["Chesterfield", "MI-Chesterfield", 163, 1950],
    ["Miami", "FL-Miami", 127, 1050],
  ];
  for (const [texto, code, venue, loc] of casos) {
    const r = A(`play card 3968122745 no flames at ${texto} receipt 19402005`);
    assert.equal(r.fields.parkCode, code, texto);
    assert.equal(r.fields.gravityVenueId, venue, texto);
    assert.equal(r.fields.locationId, loc, texto);
    assert.equal(r.dataReady, true, texto);
  }
});

test("caso real de Zarak: 'Westchase' se reconoce aunque el chat no diga 'Houston'", () => {
  const r = A("Hello kids empire Westchase I have ran into an issue i loaded a card with 50 flames but the card doesn't seem to be working the number will be 2585468226");
  assert.equal(r.fields.parkCode, "TX-Houston Westchase");
  assert.equal(r.fields.gravityVenueId, 22);
  assert.equal(r.fields.locationId, 1063);
  assert.ok(!r.missing.includes("park"), "ya no pregunta el parque");
});

test("Moreno Valley vive en otra organización de Amusement", () => {
  const r = A("play card 3968122745 no flames at Moreno Valley receipt 19402005");
  assert.equal(r.fields.locationId, 1432);
  assert.equal(r.fields.organizationId, "f48e2a80-02da-446b-8085-054df291692f");
});

test("un parque ambiguo no se adivina: pregunta cuál", () => {
  const parks = buildParks({ parks: [
    { code: "XX-Norte Bridge", name: "Norte Bridge", state: "XX", gravityVenueId: 1, amusementLocationId: 11, partialAliases: ["bridge"] },
    { code: "XX-Sur Bridge", name: "Sur Bridge", state: "XX", gravityVenueId: 2, amusementLocationId: 12, partialAliases: ["bridge"] },
  ] });
  const r = A("play card 3968122745 no flames at Bridge receipt 19402005", { parks });
  assert.equal(r.fields.parkKey, null);
  assert.ok(r.missing.includes("park"));
  assert.match(r.reply, /May I know in which park are you located/);
});

test("el nombre propio de un parque gana a los alias parciales de otros (Mesa no es Costa Mesa)", () => {
  assert.equal(A("play card 3968122745 no flames at Mesa receipt 19402005").fields.parkCode, "AZ-Mesa");
  assert.equal(A("play card 3968122745 no flames at Costa Mesa receipt 19402005").fields.parkCode, "CA-Costa Mesa");
});

test("un parque que no existe en el directorio se pregunta", () => {
  const r = A("play card 3968122745 no flames at Atlantis receipt 19402005");
  assert.ok(r.missing.includes("park"));
});

test("el alias más largo gana: 'North Aurora' no se confunde con 'Aurora'", () => {
  const r = A("play card 3968122745 no flames at North Aurora receipt 19402005");
  assert.equal(r.fields.parkCode, "IL-North Aurora");
});

test("flames del texto se guardan, pero no son obligatorios en el protocolo con recibo", () => {
  const r = A("play card 3968122745 at Arlington receipt 19402005 $20 = 102 flames");
  assert.equal(r.fields.flames, 102);
  assert.equal(r.fields.amountUsd, 20);
  const sin = A("play card 3968122745 at Arlington receipt 19402005");
  assert.equal(sin.fields.flames, null);
  assert.equal(sin.dataReady, true);
});

/* ---------- Protocolo test card ---------- */

test("test card · se carga siempre $10 = 50 flames, sin recibo ni Gravity", () => {
  const r = A("test card 3968122745 at Arlington please, need 102 flames");
  assert.equal(r.protocol, "test_card");
  assert.equal(r.fields.flames, 50);
  assert.equal(r.fields.amountUsd, 10);
  assert.equal(r.fields.reason, "test_card");
  assert.equal(r.fields.receiptNumber, null);
  assert.equal(r.dataReady, true);
  assert.ok(!r.missing.includes("receipt"));
  assert.ok(r.steps.read.every((s) => !/Gravity/.test(s)), "no consulta Gravity");
  assert.ok(r.steps.read.some((s) => /nadie/i.test(s)));
  assert.ok(r.pendingChecks.length >= 1);
  assert.equal(r.canApprove, false);
});

test("test card · sin tarjeta o parque: pregunta con nombre", () => {
  const r = A("we need a test card loaded");
  assert.equal(r.protocol, "test_card");
  assert.ok(r.missing.includes("card") && r.missing.includes("park"));
  assert.match(r.reply, /^Hello Rashel, /);
});

test("sin la palabra 'test' no se activa el protocolo de prueba ($10 = 50 no se aplica)", () => {
  const r = A("card 3968122745 no flames at Arlington receipt 19402005");
  assert.equal(r.protocol, "receipt");
  assert.notEqual(r.fields.flames, 50);
});

test("'guest' o 'testing' no activan el protocolo test", () => {
  assert.equal(A("guest play card 3968122745 no flames at Arlington").protocol, "receipt");
});

/* ---------- Fuera de alcance ---------- */

test("tarjeta doblada que no escanea: fuera de alcance, se escala con el nombre", () => {
  const r = A("hi i had a customer purchase a $20 play card but the card is bent and won't scan for any of the rides");
  assert.equal(r.isFlameRequest, true);
  assert.equal(r.protocol, "out_of_scope");
  assert.equal(r.replyKind, "escalation");
  assert.equal(r.reply, "Hello Rashel, allow me take a look, thank you!");
  assert.equal(r.canApprove, false);
  assert.equal(r.steps.read.length + r.steps.execute.length, 0);
});

test("reembolso: fuera de alcance, se escala", () => {
  const r = A("Guest wants a refund for the play card");
  assert.equal(r.protocol, "out_of_scope");
  assert.equal(r.replyKind, "escalation");
});

test("temas ajenos no son pedidos de flames", () => {
  assert.equal(A("Where can I buy a gift?").isFlameRequest, false);
});

/* ---------- Nombre siempre ---------- */

test("sin nombre conocido, el saludo igual existe", () => {
  const r = analyzeFlameRequest({ text: "Playcard not loading flames", author: "" });
  assert.match(r.reply, /^Hello, /);
});

/* ---------- Visión: los hechos de la foto alimentan al extractor ---------- */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeOcr } from "./vision.js";

const HERE_T = path.dirname(fileURLToPath(import.meta.url));
const photo = (id) => analyzeOcr(JSON.parse(fs.readFileSync(path.join(HERE_T, "test-fixtures", `ocr-${id}.json`), "utf8")));

test("foto: el Receipt Number, el parque y los flames salen del ticket cuando el texto no los trae", () => {
  const r = A("Hi, play card 3968122745 has no flames", { vision: photo("03") });
  assert.equal(r.fields.receiptNumber, "19396510");
  assert.equal(r.fields.receiptSource, "foto");
  assert.equal(r.fields.parkCode, "GA-Marietta");
  assert.equal(r.fields.parkSource, "foto");
  assert.equal(r.fields.flames, 204, "$20 = 102 flames x 2");
  assert.equal(r.fields.amountUsd, 40);
  assert.equal(r.fields.flamesSource, "foto");
  assert.equal(r.reply, null, "ya no pregunta lo que viene en la foto");
  assert.equal(r.dataReady, true);
});

test("foto: @Arcade amount manda sobre la multiplicación", () => {
  const v = photo("04");
  const r = A("play card 3968122745 no flames loaded", { vision: v });
  assert.equal(r.fields.flames, 24);
  assert.equal(r.fields.parkCode, "NJ-North Bergen");
});

test("foto: un ticket con varios brazaletes es de varias tarjetas y se escala", () => {
  const r = A("play card 3968122745 no flames loaded", { vision: photo("05") });
  assert.equal(r.protocol, "out_of_scope");
  assert.equal(r.reply, "Hello Rashel, allow me take a look, thank you!");
  assert.match(r.understood, /4 tarjetas/);
});

test("foto de baja confianza: el recibo queda por confirmar y el verde no se habilita", () => {
  const r = A("play card 3968122745 no flames at Arlington", { vision: photo("zarak-chat") });
  assert.equal(r.fields.receiptSource, "foto");
  assert.equal(r.fields.receiptConfirmed, false);
  assert.ok(r.blockers.some((b) => /baja confianza/.test(b)));
  assert.equal(r.dataReady, false);
  assert.equal(r.reply, null, "no se le pregunta al staff algo que sí mandó");
});

test("foto de baja confianza: corregir o confirmar el número lo habilita", () => {
  const r = A("play card 3968122745 no flames at Arlington", { vision: photo("zarak-chat"), overrides: { receiptNumber: "19420186" } });
  assert.equal(r.fields.receiptConfirmed, true);
  assert.equal(r.fields.receiptSource, "corregido");
  assert.equal(r.dataReady, true);
});

test("el texto manda sobre la foto: si el staff escribió el recibo, no se usa el de la foto", () => {
  const r = A("play card 3968122745 at Arlington receipt #19400000", { vision: photo("03") });
  assert.equal(r.fields.receiptNumber, "19400000");
  assert.equal(r.fields.receiptSource, "texto");
});

test("foto sin recibo legible: pregunta con la frase de la KB y pide una foto más clara", () => {
  const vision = { facts: { attempted: true } };
  const r = A("play card 3968122745 no flames at Arlington", { vision });
  assert.ok(r.missing.includes("receipt"));
  assert.match(r.reply, /Could you please share the Receipt ID/);
  assert.match(r.reply, /send a clearer one/);
});

test("foto con dos recibos distintos: pide confirmar cuál", () => {
  const vision = { facts: { attempted: true, receiptConflict: ["19402005", "19402006"] } };
  const r = A("play card 3968122745 no flames at Arlington", { vision });
  assert.match(r.reply, /confirm which one is the Receipt ID: 19402005 or 19402006/);
});

test("V2 parcial: los últimos 4 de la Play Card del ticket deben coincidir con la tarjeta del chat", () => {
  const vision = { facts: { attempted: true, receiptNumber: "19402005", playCardLast4: "6571" } };
  const mal = A("play card 3968122745 no flames at Arlington", { vision });
  assert.equal(mal.replyKind, "mismatch");
  assert.match(mal.reply, /play card and receipt info doesn't match/);
  assert.equal(mal.dataReady, false);
  const bien = A("play card 3966586571 no flames at Arlington", { vision });
  assert.equal(bien.replyKind, null);
  assert.equal(bien.dataReady, true);
});

test("test card ignora los flames de la foto: siempre $10 = 50", () => {
  const r = A("test card 3968122745 at Arlington", { vision: photo("03") });
  assert.equal(r.fields.flames, 50);
  assert.equal(r.fields.amountUsd, 10);
});

/* ---------- Visión: fotos de la pantalla de Gravity ---------- */

test("pantalla de Gravity (S01): flames, parque y recibo salen de la foto y queda lista para validar", () => {
  const r = A("Hello, play card 3968122745 did not load the flames", { vision: photo("S01") });
  assert.equal(r.fields.parkCode, "CA-Woodland Hills");
  assert.equal(r.fields.locationId, 1076);
  assert.equal(r.fields.receiptNumber, "19419819");
  assert.equal(r.fields.flames, 50);
  assert.equal(r.fields.amountUsd, 10);
  assert.equal(r.dataReady, true);
  assert.equal(r.reply, null);
});

test("un recibo completo sin línea de flames NO se escala: se avisa y Gravity decide (caso A o B)", () => {
  for (const id of ["01", "02", "S02", "S04"]) {
    const r = A("Hi, play card 3968122745 has no flames loaded", { vision: photo(id) });
    assert.equal(r.protocol, "receipt", id);
    assert.equal(r.dataReady, true, id);
    assert.equal(r.reply, null, id);
    assert.ok(r.warnings.some((w) => /caso A/.test(w) && /caso B/.test(w)), id);
  }
  assert.equal(A("play card 3968122745 no flames", { vision: photo("S02") }).warnings[0].includes("Punchcard"), true);
});

test("S03 (foto cortada, sin Transaction #): no se escala; pide el Receipt ID y una foto más clara", () => {
  const r = A("Hi, play card 3968122745 has no flames loaded", { vision: photo("S03") });
  assert.equal(r.protocol, "receipt");
  assert.ok(r.missing.includes("receipt"));
  assert.match(r.reply, /Could you please share the Receipt ID/);
  assert.match(r.reply, /clearer one/);
});

test("PLAY_CARD completo en la foto: si no coincide con el del chat, respuesta de 'no coincide'", () => {
  const base = { facts: { attempted: true, receiptNumber: "19402005", playCardOnReceipt: "1111111111" } };
  const mal = A("play card 3968122745 no flames at Arlington", { vision: base });
  assert.equal(mal.replyKind, "mismatch");
  assert.ok(mal.blockers.some((b) => /1111111111/.test(b)));
  const bien = A("play card 1111111111 no flames at Arlington", { vision: base });
  assert.equal(bien.replyKind, null);
  assert.equal(bien.dataReady, true);
});

test("la cantidad de la línea de flames que no se pudo leer se marca para verificar", () => {
  const vision = { facts: { attempted: true, receiptNumber: "19402005", flames: { unitAmount: 10, flamesPerUnit: 50, qty: 1, qtyAssumed: true } } };
  const r = A("play card 3968122745 no flames at Arlington", { vision });
  assert.ok(r.blockers.some((b) => /cantidad/.test(b)));
  assert.equal(r.dataReady, false);
  const corregido = A("play card 3968122745 no flames at Arlington", { vision, overrides: { flames: 50, amountUsd: 10 } });
  assert.equal(corregido.dataReady, true, "corregir los flames lo habilita");
});

/* ---------- Lectura en Gravity: veredicto A / B / escalar ---------- */
import { normalizeGravity } from "./gravity.js";

const rawG = (over = {}) => ({
  found: true, transactionId: 19400001, venueId: 22, venueName: "TX-Houston Westchase", date: "2026-10-09T13:21:17.217", deviceName: "WESTCHASE POS 3",
  total: 21, status: 6, type: 1, note: "",
  products: [{ name: "Play Card", qty: 1, price: 1, gpCardType: 0 }, { name: "$20 = 102 flames", qty: 1, price: 20, gpCardType: 5 }],
  gpCards: [{ code: "2222222222", originalBalance: 20, remainingBalance: 0, gpCardType: 5 }],
  payments: [{ type: "Credit Payment", amount: 21 }], ...over,
});
const GRV = (over) => normalizeGravity(rawG(over));
const TXT = "Hello kids empire Westchase, the play card 2222222222 did not load the flames, receipt #19400001";

test("Gravity caso A: el recibo existe, está pagado y la tarjeta coincide → solo falta revisar Amusement", () => {
  const r = A(TXT, { gravity: GRV() });
  assert.equal(r.verdict, "A");
  assert.equal(r.fields.flames, 102);
  assert.equal(r.fields.flamesSource, "gravity");
  assert.equal(r.fields.amountUsd, 20);
  assert.equal(r.fields.parkCode, "TX-Houston Westchase");
  assert.equal(r.fields.locationId, 1063);
  assert.equal(r.reply, null);
  assert.equal(r.pendingChecks.length, 1, "la lectura de Gravity ya no está pendiente");
  assert.match(r.pendingChecks[0], /Amusement/);
  assert.equal(r.canApprove, false, "el verde espera la revisión de Amusement");
  assert.ok(r.evidence.length >= 5 && r.evidence.every((c) => c.status === "ok"));
});

test("Gravity caso B: la tarjeta del chat no es la del recibo → respuesta R-V2 y sin verde", () => {
  const r = A(TXT.replace("2222222222", "3333333333"), { gravity: GRV() });
  assert.equal(r.verdict, "B");
  assert.equal(r.replyKind, "mismatch");
  assert.equal(r.reply, "Hello Rashel, It looks like the play card and receipt info doesn't match, feel free to find the correct play card or receipt, thank you!");
  assert.ok(r.blockers.some((b) => /Gravity: La tarjeta del chat no coincide/.test(b)));
  assert.equal(r.canApprove, false);
  assert.deepEqual(r.pendingChecks, []);
});

test("Gravity caso B: el recibo no existe", () => {
  const r = A(TXT, { gravity: normalizeGravity({ found: false, httpStatus: 500 }) });
  assert.equal(r.verdict, "B");
  assert.equal(r.replyKind, "mismatch");
});

test("Gravity caso B: el recibo es de otro parque que el que dijo el staff", () => {
  const r = A(TXT, { gravity: GRV({ venueId: 197, venueName: "FL-Tampa Bradenton" }) });
  assert.equal(r.verdict, "B");
  assert.ok(r.blockers.some((b) => /otro parque/.test(b)));
  assert.equal(r.fields.parkCode, "TX-Houston Westchase", "no se pisa lo que dijo el staff");
});

test("Gravity escalar: un recibo con varias tarjetas se escala (caso real de Zarak)", () => {
  const r = A(TXT, { gravity: GRV({ products: [{ name: "Play Card", qty: 2, price: 1, gpCardType: 0 }, { name: "$10 = 50 flames", qty: 2, price: 10, gpCardType: 5 }], total: 22, payments: [{ type: "Credit Payment", amount: 22 }] }) });
  assert.equal(r.verdict, "escalate");
  assert.equal(r.replyKind, "escalation");
  assert.equal(r.reply, "Hello Rashel, allow me take a look, thank you!");
});

test("Gravity confirma un Receipt Number leído de la foto con baja confianza cuando es del parque que dijo el staff", () => {
  const sinTexto = "Hello kids empire Westchase, the play card 2222222222 did not load the flames";
  const antes = A(sinTexto, { vision: photo("zarak-chat") });
  assert.equal(antes.fields.receiptConfirmed, false);
  const g = GRV({ transactionId: Number(antes.fields.receiptNumber) });
  const r = A(sinTexto, { vision: photo("zarak-chat"), gravity: g });
  assert.equal(r.fields.receiptConfirmed, true);
  assert.equal(r.fields.receiptSource, "foto+gravity");
  assert.ok(!r.blockers.some((b) => /baja confianza/.test(b)));
});

test("Gravity: lo que corrige una persona (flames, monto) no se pisa", () => {
  const r = A(TXT, { gravity: GRV(), overrides: { flames: 50, amountUsd: 10 } });
  assert.equal(r.fields.flames, 50);
  assert.equal(r.fields.amountUsd, 10);
});

test("sin tarjeta en el chat: Gravity queda pendiente de comparar, no decide B", () => {
  const r = A("Hello kids empire Westchase, flames did not load, receipt #19400001", { gravity: GRV() });
  assert.equal(r.verdict, "pending");
  assert.match(r.reply, /play card number/);
});

test("el protocolo test card no consulta Gravity", () => {
  const r = A("test card 2222222222 at Arlington", { gravity: GRV() });
  assert.equal(r.verdict, "pending");
  assert.deepEqual(r.evidence, []);
});

/* ---------- Mensajes REALES del chat (2026-10-09; números de tarjeta sustituidos por otros sintéticos) ---------- */

const REAL_EILEEN = "Hello Woodland Hills location here I had a guest who just got checked in and purchased a $10 flame play card and once payment went through it notified me that I had to load to card manually can I get some assistance with this POS 1 Card number: 0123456789";
const REAL_JANISA = "hi this is janisa from north bergen , a customer purchased a playcard and the points were never loaded. The card number is 1234567890 and this is the receipt";
const REAL_ANTONIO = "She just needs her play card loaded";

test("real (Eileen): '$10 flame' es un MONTO, no 10 flames; los flames salen de la lista de la KB (50)", () => {
  const r = A(REAL_EILEEN, { greetingName: "Eileen" });
  assert.equal(r.fields.amountUsd, 10);
  assert.equal(r.fields.flames, 50, "$10 = 50 flames");
  assert.equal(r.fields.flamesSource, "lista");
  assert.equal(r.fields.parkCode, "CA-Woodland Hills");
  assert.equal(r.fields.card, "0123456789", "el 0 inicial no se pierde");
  assert.equal(r.fields.cardConfirmed, true);
  assert.deepEqual(r.missing, ["receipt"]);
  assert.equal(r.reply, "Hello Eileen, Could you please share the Receipt ID (Transaction #) of the purchase?");
});

test("real (Janisa): 'playcard' sin espacio y 'north bergen'; sin foto leída pide el recibo, con la foto no", () => {
  const sin = A(REAL_JANISA, { greetingName: "Janisa" });
  assert.equal(sin.fields.parkCode, "NJ-North Bergen");
  assert.equal(sin.fields.card, "1234567890");
  assert.deepEqual(sin.missing, ["receipt"]);
  const con = A(REAL_JANISA, { greetingName: "Janisa", vision: photo("04") });
  assert.equal(con.fields.receiptNumber, "19387787");
  assert.equal(con.reply, null, "ya no pregunta lo que viene en la foto");
  assert.equal(con.dataReady, true);
});

test("real (Antonio): sin datos, pide parque, tarjeta y recibo con las frases de la KB", () => {
  const r = A(REAL_ANTONIO, { greetingName: "Antonio" });
  assert.deepEqual(r.missing.sort(), ["card", "park", "receipt"]);
  assert.match(r.reply, /^Hello Antonio, May I know in which park/);
});

test("un monto que no está en la lista no inventa flames", () => {
  const r = A("play card 3968122745 purchased $7 flames at Arlington receipt 19402005");
  assert.equal(r.fields.flames, null);
});

test("'50 flames' escrito como cantidad sigue siendo cantidad", () => {
  const r = A("I loaded a card with 50 flames but it does not work, play card 3968122745 at Arlington");
  assert.equal(r.fields.flames, 50);
  assert.notEqual(r.fields.flamesSource, "lista");
});
