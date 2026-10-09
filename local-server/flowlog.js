/**
 * Registro (logs) del flujo real de un pedido de flames (spec 001, R-15).
 *
 * Una instancia mantiene en memoria los logs abiertos por caseId. Cada análisis del panel y cada
 * decisión de Juan (aprobar / negar) se escriben como eventos; el caso se cierra con su resultado.
 * Si el servidor se reinicia a mitad de un caso, los eventos siguientes abren el mismo caseId otra
 * vez: el visor los ordena por hora, así que la línea de tiempo sigue completa.
 */

import { createLog } from "./logs.js";

// Tipos que el panel puede registrar por su cuenta. Las acciones en sistemas (`action`) nunca.
const PANEL_KINDS = ["approval", "reply", "error"];
const PANEL_OUTCOMES = ["prepared_for_human", "denied", "executed", "error"];

const clip = (s, n = 1500) => String(s ?? "").slice(0, n);

export function createFlowLogger({ dir } = {}) {
  const open = new Map(); // caseId -> log abierto
  const opts = dir ? { dir } : undefined;

  function logFor(caseId, meta) {
    if (!open.has(caseId)) open.set(caseId, { log: createLog({ caseId, ...meta }, opts), started: false });
    return open.get(caseId);
  }

  function close(caseId, outcome, summary) {
    const entry = open.get(caseId);
    if (!entry) return;
    entry.log.end(outcome, summary);
    open.delete(caseId);
  }

  return {
    /** Registra lo que entendió el panel. `edited` = true cuando Juan corrigió campos (re-evaluación). */
    onAnalysis({ caseId, text, author, edited = false }, a) {
      if (!caseId || !a || !a.isFlameRequest) return;
      const entry = logFor(caseId, { author: clip(author, 200), channel: "Gravity Support" });
      const { log } = entry;
      if (!entry.started) {
        entry.started = true;
        log.add("input", "Mensaje recibido en Connecteam", clip(text), { system: "connecteam", author: clip(author, 200) });
        log.add("match", `Protocolo: ${a.protocol}`, a.understood, { protocol: a.protocol });
      } else if (edited) {
        log.add("extract", "Juan corrigió campos en el panel", a.understood, { fields: a.fields });
      }
      if (a.protocol === "out_of_scope") {
        log.add("escalation", "Fuera de alcance de flames", a.understood, { reply: a.reply });
        close(caseId, "escalated", a.understood);
        return;
      }
      if (!edited) log.add("extract", "Datos capturados", a.understood, { fields: a.fields, missing: a.missing });
      log.add(
        "check",
        a.dataReady ? "Datos completos" : "Faltan datos o hay una guarda sin cumplir",
        [...a.blockers, ...a.pendingChecks].join("; "),
        { blockers: a.blockers, pendingChecks: a.pendingChecks, canApprove: a.canApprove },
      );
      if (a.reply) log.add("reply", "Pregunta propuesta al staff (en inglés)", a.reply, { replyKind: a.replyKind });
    },

    /** Registra lo que leyó la foto: hallazgos, posición y confianza. La imagen NO se guarda (spec 003, R-12). */
    onVision(caseId, result) {
      if (!caseId || !result) return;
      const { log } = logFor(caseId, {});
      const found = result.findings.filter((x) => !x.ignored);
      log.add(
        "vision",
        `Lectura de la foto: ${found.length} hallazgo(s), ${result.notFound.length} no encontrado(s)`,
        found.map((x) => `${x.label}: ${x.value ?? x.text} (${Math.round(x.score * 100)}%)`).join("; "),
        {
          size: [result.width, result.height],
          ms: result.ms,
          findings: result.findings.map((x) => ({ kind: x.kind, text: x.text, value: x.value, score: x.score, lowConfidence: x.lowConfidence, ignored: x.ignored, box: x.box })),
          notFound: result.notFound,
          facts: result.facts,
        },
      );
    },

    /** La consulta se pidió (aunque nadie la atienda todavía). */
    onLookupRequested(caseId, { system, kind, params }) {
      if (!caseId) return;
      const { log } = logFor(caseId, {});
      log.add("action", `${system === "gravity" ? "Gravity" : "Amusement"} · se pidió una lectura (solo lectura)`, JSON.stringify(params), { system, where: `cola de consultas · ${kind}`, query: JSON.stringify(params) });
    },

    /** La consulta falló, caducó o el lector devolvió un error: se dice por qué, en vez de quedar en silencio. */
    onLookupFailed(caseId, { system, status, error }) {
      if (!caseId) return;
      const { log } = logFor(caseId, {});
      const nombre = system === "gravity" ? "Gravity" : "Amusement";
      const motivo = status === "expired" ? `Nadie atendió la consulta a tiempo: ¿está abierta una pestaña de ${nombre} con sesión y el lector instalado?` : error || "El lector devolvió un error";
      log.add("error", `${nombre} · no se pudo hacer la lectura`, motivo, { system, status });
    },

    /** Registra la consulta de solo lectura a Gravity y su resultado (sin datos personales). */
    onGravity(caseId, { receiptNumber, gravity, evaluation }) {
      if (!caseId) return;
      const { log } = logFor(caseId, {});
      log.add("action", "Gravity · leer el recibo (solo lectura)", `Receipt Number #${receiptNumber}`, { system: "gravity", where: "api/CheckOut/transactionDetail", query: receiptNumber });
      log.add("evidence", gravity.found ? `Gravity: ${gravity.venueName} · ${gravity.deviceName}` : "Gravity: el recibo no existe", (evaluation?.checks || []).map((c) => `${c.status === "ok" ? "✓" : c.status === "fail" ? "✗" : "·"} ${c.label}${c.detail ? ": " + c.detail : ""}`).join("\n"), { found: gravity.found, venueId: gravity.venueId ?? null, products: gravity.products, total: gravity.total, status: gravity.status });
      if (evaluation) log.add("decision", `Veredicto de Gravity: ${evaluation.verdict}${evaluation.reason ? " (" + evaluation.reason + ")" : ""}`, "", { verdict: evaluation.verdict, reason: evaluation.reason });
    },

    /** Evento enviado por el panel (aprobación, respuesta, error). Si trae `outcome`, cierra el caso. */
    onPanelEvent(body) {
      const caseId = clip(body?.caseId, 120);
      if (!caseId) throw new Error("Falta caseId");
      if (!PANEL_KINDS.includes(body.kind)) throw new Error(`Tipo no permitido desde el panel: ${body.kind}`);
      if (body.outcome !== undefined && !PANEL_OUTCOMES.includes(body.outcome)) throw new Error(`Resultado no permitido: ${body.outcome}`);
      const { log } = logFor(caseId, {});
      log.add(body.kind, clip(body.title, 200), clip(body.detail), body.data && typeof body.data === "object" ? body.data : undefined);
      if (body.outcome) close(caseId, body.outcome, clip(body.detail, 300));
    },
  };
}
