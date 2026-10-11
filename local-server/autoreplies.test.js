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
  assert.equal(refundAnalysis({ stage: "submitted", greetingName: "Rashel" }).reply, "Rashel, thank you so much! We will review it.");
  assert.equal(refundAnalysis({ stage: "declined", greetingName: "Rashel" }).reply, "Rashel, understood, feel free to do so!! Thank you.");
  assert.equal(refundAnalysis({ stage: "unclear" }).reply, null);
  for (const r of Object.values(REFUND_TEXTS)) assert.ok(!r("X").includes(String.fromCharCode(10)));
  for (const stage of ["asked", "submitted", "stated", "status", "declined"]) assert.ok(refundAnalysis({ stage, greetingName: "Rashel" }).reply.startsWith("Rashel, "), `${stage} lleva el nombre`);
});

test("avisos de que ya se envió la solicitud (spec 008, regla 4)", async () => {
  const { isRefundSubmittedStatement } = await import("./autoreplies.js");
  for (const t of ["We just submitted a refund request", "I just submitted a refund", "I submitted a refund", "Refund has been submitted", "refund has already been submitted"]) assert.ok(isRefundSubmittedStatement(t), t);
  for (const t of ["I am requesting a refund", "we have not submitted the refund", "needs a refund", "the card did not load"]) assert.equal(isRefundSubmittedStatement(t), false, t);
});

test("preguntas por el estado del reembolso (regla 5); sin la palabra refund solo con contexto", async () => {
  const { isRefundStatusQuestion } = await import("./autoreplies.js");
  for (const t of ["Any update with this refund", "Guest is waiting for refund", "How long does the refund take?"]) assert.ok(isRefundStatusQuestion(t), t);
  for (const t of ["How long takes", "any word with this update"]) { assert.equal(isRefundStatusQuestion(t), false, t); assert.ok(isRefundStatusQuestion(t, true), t); }
  assert.equal(isRefundStatusQuestion("the card did not load", true), false);
});

test("textos literales de las reglas 4 y 5", () => {
  assert.equal(refundAnalysis({ stage: "stated", greetingName: "Rashel" }).reply, "Rashel, thank you so much! We will review your case");
  assert.ok(refundAnalysis({ stage: "status", greetingName: "Rashel" }).reply.startsWith("Rashel, to be transparent, we handle a high volume of refund requests"));
  assert.ok(refundAnalysis({ stage: "status" }).reply.endsWith("as soon as it’s completed"));
});
