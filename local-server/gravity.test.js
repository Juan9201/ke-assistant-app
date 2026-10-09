import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeGravity, evaluateGravity, flamesLines } from "./gravity.js";

// Recibos SINTÉTICOS con la forma real de la API (sin tarjetas ni clientes reales).
const raw = (over = {}) => ({
  found: true,
  transactionId: 19400001,
  venueId: 22,
  venueName: "TX-Houston Westchase",
  date: "2026-10-09T13:21:17.217",
  deviceName: "WESTCHASE POS 3",
  total: 21,
  status: 6,
  type: 1,
  note: "",
  products: [
    { name: "Play Card", qty: 1, price: 1, gpCardType: 0 },
    { name: "$20 = 102 flames", qty: 1, price: 20, gpCardType: 5 },
  ],
  gpCards: [{ code: "2222222222", originalBalance: 20, remainingBalance: 0, gpCardType: 5 }],
  payments: [{ type: "Credit Payment", amount: 21 }],
  ...over,
});
const G = (over) => normalizeGravity(raw(over));
const ev = (over, extra = {}) => evaluateGravity({ gravity: G(over), chatCard: "2222222222", expectedVenueId: 22, ...extra });
const failedIds = (r) => r.checks.filter((c) => c.status === "fail").map((c) => c.id);

test("normalizeGravity: lista blanca; nunca deja pasar nombres, teléfonos ni correos", () => {
  const sucio = raw({ cashier: "x@kidsempire.us", customerName: "Persona Real", adultCustomers: [{ name: "Persona Real", phone: "555" }], email: "a@b.c", phoneNumber: "555", recipientName: "Persona Real" });
  sucio.gpCards[0].recipientName = "Persona Real";
  sucio.gpCards[0].email = "a@b.c";
  const n = normalizeGravity(sucio);
  assert.ok(!/Persona|@|555/.test(JSON.stringify(n)), JSON.stringify(n));
  assert.equal(n.gpCards[0].code, "2222222222");
});

test("normalizeGravity: tipos y largos acotados; entradas raras no rompen", () => {
  assert.deepEqual(normalizeGravity(null), { found: false, reason: "invalid" });
  assert.equal(normalizeGravity({ found: false, httpStatus: 500 }).found, false);
  const n = normalizeGravity(raw({ total: "21.5", products: "no es lista", note: "x".repeat(999) }));
  assert.equal(n.total, 21.5);
  assert.deepEqual(n.products, []);
  assert.equal(n.note.length, 200);
});

test("caso A: recibo válido, pagado, una tarjeta que coincide → Gravity tiene los flames", () => {
  const r = ev({});
  assert.equal(r.verdict, "A");
  assert.equal(r.facts.flames, 102);
  assert.equal(r.facts.amountUsd, 20);
  assert.equal(r.facts.venueId, 22);
  assert.ok(r.checks.every((c) => c.status === "ok"));
});

test("caso B: la tarjeta del chat NO es la del recibo → pedir rectificación (V2)", () => {
  const r = ev({}, { chatCard: "3333333333" });
  assert.equal(r.verdict, "B");
  assert.equal(r.reason, "play_card");
  assert.match(r.checks.find((c) => c.id === "play_card").detail, /3333333333.*2222222222/);
});

test("caso B: el recibo no existe en Gravity (número mal dado o mal leído)", () => {
  const r = evaluateGravity({ gravity: normalizeGravity({ found: false, httpStatus: 500 }), chatCard: "2222222222" });
  assert.equal(r.verdict, "B");
  assert.equal(r.reason, "receipt_not_found");
});

test("caso B: el recibo es de otro parque que el que dijo el staff", () => {
  const r = ev({ venueId: 197, venueName: "FL-Tampa Bradenton" });
  assert.equal(r.verdict, "B");
  assert.equal(r.reason, "venue");
});

test("caso B: el recibo no tiene ninguna línea de flames (Gravity decide, no la foto)", () => {
  const r = ev({ products: [{ name: "Child Entrance", qty: 1, price: 19.9, gpCardType: 0 }], gpCards: [], total: 19.9, payments: [{ type: "Credit Payment", amount: 19.9 }] });
  assert.equal(r.verdict, "B");
  assert.equal(r.reason, "flames_line");
});

test("escalar: recibo no pagado, anulado o con otro estado", () => {
  assert.equal(ev({ status: 9 }).verdict, "escalate");
  assert.equal(ev({ status: 9 }).reason, "paid");
  assert.equal(ev({ payments: [{ type: "Credit Payment", amount: 5 }] }).reason, "paid");
});

test("escalar: varias líneas de flames o varias tarjetas en el recibo", () => {
  const dos = ev({ products: [{ name: "$10 = 50 flames", qty: 1, price: 10, gpCardType: 5 }, { name: "$20 = 102 flames", qty: 1, price: 20, gpCardType: 5 }], total: 30, payments: [{ type: "Credit Payment", amount: 30 }] });
  assert.equal(dos.verdict, "escalate");
  assert.equal(dos.reason, "multi_flames");
  const tarjetas = ev({ products: [{ name: "Play Card", qty: 2, price: 1, gpCardType: 0 }, { name: "$10 = 50 flames", qty: 2, price: 10, gpCardType: 5 }], total: 22, payments: [{ type: "Credit Payment", amount: 22 }] });
  assert.equal(tarjetas.verdict, "escalate");
  assert.equal(tarjetas.reason, "multi_card");
});

test("escalar: el recibo no trae PLAY_CARD (solo se vendieron flames): V2 no se puede validar", () => {
  const r = ev({ gpCards: [] });
  assert.equal(r.verdict, "escalate");
  assert.equal(r.reason, "card_on_receipt");
});

test("sin tarjeta del chat: queda pendiente (aviso), no se decide", () => {
  const r = ev({}, { chatCard: null });
  assert.equal(r.verdict, "pending");
  assert.equal(r.checks.find((c) => c.id === "play_card").status, "warn");
});

test("prioridad: si el staff se equivocó (B) gana sobre lo que haya que escalar", () => {
  const r = ev({ status: 9 }, { chatCard: "3333333333" });
  assert.equal(r.verdict, "B");
});

test("las tarjetas que no son de flames no cuentan como PLAY_CARD", () => {
  const r = ev({ gpCards: [{ code: "9999999999", gpCardType: 1 }] });
  assert.equal(r.reason, "card_on_receipt");
});

test("flamesLines: total = flames por unidad × cantidad; ignora productos que no son flames", () => {
  const l = flamesLines(G({ products: [{ name: "Play Card", qty: 4, price: 1, gpCardType: 0 }, { name: "$20 = 102 flames", qty: 4, price: 20, gpCardType: 5 }] }));
  assert.equal(l.length, 1);
  assert.equal(l[0].total, 408);
  assert.equal(l[0].amount, 80);
});

test("sin lectura todavía: veredicto pendiente", () => {
  assert.equal(evaluateGravity({ gravity: null }).verdict, "pending");
});
