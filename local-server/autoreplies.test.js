import { test } from "node:test";
import assert from "node:assert/strict";
import { isRefundRequest, readYesNo, refundAnalysis, REFUND_TEXTS } from "./autoreplies.js";

test("las frases de Juan activan la regla de reembolso", () => {
  for (const t of ["needs a refund", "we need a refund processed", "can we get a refund?", "I am requesting a refund", "Hello, guest needs a REFUND please"]) assert.ok(isRefundRequest(t), t);
});

test("reembolsos ya hechos, negados o sin pedido no activan la regla", () => {
  for (const t of ["the guest was refunded", "refund request submitted already", "no need for a refund", "we don't need a refund", "the card did not load", ""]) assert.equal(isRefundRequest(t), false, t);
});

test("sí / no / ambiguo / otro tema", () => {
  for (const t of ["yes", "Yes did", "yes I did", "Yeah", "done!", "Submitted"]) assert.equal(readYesNo(t), "yes", t);
  for (const t of ["No", "nope", "not yet", "I haven't", "no I didn't"]) assert.equal(readYesNo(t), "no", t);
  for (const t of ["maybe", "no, yes", "hmm"]) assert.equal(readYesNo(t), "unclear", t);
  for (const t of ["what form?", "", "the machine at the front is also broken and the guest is waiting for help with it now"]) assert.equal(readYesNo(t), "not_answer", t);
});

test("textos literales, en una sola línea, y la pregunta lleva el nombre", () => {
  assert.equal(refundAnalysis({ stage: "asked", author: "AM Rashel Carswell", greetingName: "Rashel" }).reply, "Rashel, did you submit the refund request, correct?");
  assert.equal(refundAnalysis({ stage: "submitted" }).reply, "Thank you so much! We will review it.");
  assert.equal(refundAnalysis({ stage: "declined" }).reply, "Understood, feel free to do so!! Thank you.");
  assert.equal(refundAnalysis({ stage: "unclear" }).reply, null);
  for (const r of Object.values(REFUND_TEXTS)) assert.ok(!String(typeof r === "function" ? r("X") : r).includes("\n"));
});
