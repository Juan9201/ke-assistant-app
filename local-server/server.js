/**
 * KE Assistant — server local (reemplaza al Worker de Cloudflare para desarrollo
 * o para correr todo en tu propia máquina).
 *
 * Solo capa de transporte HTTP: la lógica de negocio vive en logic.js, sin cambios,
 * así que el día que quieras volver a Cloudflare solo hay que reescribir este
 * archivo, no logic.js.
 *
 * Escucha SOLO en 127.0.0.1 (nunca 0.0.0.0): nadie fuera de esta máquina puede
 * pegarle a este servidor, ni siquiera otros dispositivos en la misma red.
 */

import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAction, HttpError, parseRolePrefixes, extractGreetingName } from "./logic.js";
import { analyzeFlameRequest, ANALYSIS_CONTRACT } from "./flamerequest.js";
import { handleLogsRequest } from "./logsserver.js";
import { createFlowLogger } from "./flowlog.js";
import { createTicketStore } from "./tickets.js";
import { createCommandStore } from "./commands.js";
import { createTicketOps } from "./ticketops.js";
import { handleTicketsRequest } from "./ticketsserver.js";
import { loadParks, parkOptions } from "./parks.js";
import { readImage, mergeVision, MAX_IMAGE_BYTES } from "./vision.js";
import { createLookupStore } from "./lookups.js";
import { normalizeGravity, evaluateGravity } from "./gravity.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY_BYTES = 8_000_000; // 8 MB: cabe una foto reducida en base64 (read_image); el resto de acciones usa mucho menos

const env = {
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_OWNER: process.env.GITHUB_OWNER,
  GITHUB_REPO: process.env.GITHUB_REPO,
  GITHUB_BRANCH: process.env.GITHUB_BRANCH,
  KB_ROOT: process.env.KB_ROOT,
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLOSSARY_FILE = path.join(HERE, "..", "kb", "docs", "glosario.md");
// KE_LOGS_DIR solo lo usan las pruebas, para no escribir en los logs reales.
const LOGS_DIR = process.env.KE_LOGS_DIR || undefined;
const flowLog = createFlowLogger({ dir: LOGS_DIR });
const USERSCRIPTS = ["connecteam-listener-v2.user.js", "gravity-reader.user.js"];

// Hallazgos de las fotos por caso (en memoria; se descartan al reiniciar o al pasar de 200 casos). La imagen nunca se guarda.
const visionByCase = new Map();
const rememberVision = (caseId, result) => {
  const list = visionByCase.get(caseId) || [];
  list.push(result);
  visionByCase.delete(caseId);
  visionByCase.set(caseId, list);
  while (visionByCase.size > 200) visionByCase.delete(visionByCase.keys().next().value);
};
// Consultas de solo lectura a Gravity/Amusement: las toma el lector que corre en tu pestaña (el servidor no tiene tu sesión).
const lookups = createLookupStore();
const expiredLogged = new Set(); // consultas caducadas que ya se registraron
const gravityByCase = new Map(); // caseId -> lectura normalizada del recibo (sin datos personales)
const rememberGravity = (caseId, g) => {
  gravityByCase.delete(caseId);
  gravityByCase.set(caseId, g);
  while (gravityByCase.size > 200) gravityByCase.delete(gravityByCase.keys().next().value);
};
const visionFor = (caseId) => (caseId && visionByCase.has(caseId) ? mergeVision(visionByCase.get(caseId)) : null);

// Tickets persistentes y cola de comandos hacia Connecteam (spec 006). KE_TICKETS_FILE solo lo usan las pruebas.
const tickets = createTicketStore({ file: process.env.KE_TICKETS_FILE || undefined });
const commands = createCommandStore();
// El caseId canónico de un ticket (varios mensajes del mismo staff comparten ticket y, con él, fotos, lecturas y logs).
const canon = (id) => tickets.canonicalCase(String(id || "").slice(0, 120));

/** Nombre para saludar (sin el rango, p. ej. "AM Rashel Carswell" → "Rashel"), con la tabla de rangos del glosario local. */
function greetingNameFor(author) {
  let prefixes = new Set();
  try {
    prefixes = parseRolePrefixes(fs.readFileSync(GLOSSARY_FILE, "utf8"));
  } catch {
    /* sin glosario local: se usa la heurística de abajo */
  }
  const words = String(author || "").trim().split(/\s+/).filter(Boolean);
  if (!prefixes.size && words.length > 1 && /^(?:[A-Z]{1,3}|\*)$/.test(words[0])) return words[1];
  return extractGreetingName(author, prefixes);
}

const SHARED_SECRET = process.env.SHARED_SECRET || "";

const ops = createTicketOps({
  tickets,
  commands,
  lookups,
  log: flowLog,
  visionFor,
  gravityFor: (caseId) => gravityByCase.get(caseId) || null,
  greetingNameFor,
});
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());

function corsHeaders(req) {
  const origin = req.headers.origin;
  let allowOrigin = "*";
  if (!ALLOWED_ORIGINS.includes("*")) {
    allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Shared-Secret",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function sendJson(res, status, headers, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function isAuthorized(req) {
  if (!SHARED_SECRET) return false; // sin secret configurado, no se autoriza nada
  const provided = Buffer.from(String(req.headers["x-shared-secret"] || ""), "utf8");
  const expected = Buffer.from(SHARED_SECRET, "utf8");
  if (provided.length !== expected.length) {
    crypto.timingSafeEqual(expected, expected); // mismo costo que una comparación real
    return false;
  }
  return crypto.timingSafeEqual(provided, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Cuerpo de la solicitud demasiado grande"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const headers = corsHeaders(req);
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, headers, { ok: true, version: "local" });
    return;
  }

  // Los userscripts se sirven desde aquí para instalarlos/actualizarlos con un clic (Tampermonkey los detecta por la URL .user.js).
  // Solo Host local; sin CORS. Los lectores llevan el marcador __SHARED_SECRET__, que se reemplaza aquí con el secreto del servidor.
  if (req.method === "GET") {
    const name = new URL(req.url, "http://localhost").pathname.match(/^\/userscript\/([a-z0-9-]+\.user\.js)$/)?.[1];
    if (name && USERSCRIPTS.includes(name)) {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(req.headers.host || ""))) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      try {
        const js = fs.readFileSync(path.join(HERE, "..", "userscript", name), "utf8").replaceAll("__SHARED_SECRET__", SHARED_SECRET);
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end(js);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`No se encontró userscript/${name}`);
      }
      return;
    }
  }

  // Página y datos de logs: solo lectura, sin CORS, solo Host local (spec 001). Va aparte del resto.
  if (handleLogsRequest(req, res, { dir: LOGS_DIR })) return;
  if (handleTicketsRequest(req, res, { tickets, logsDir: LOGS_DIR, secret: SHARED_SECRET })) return;

  if (req.method !== "POST") {
    sendJson(res, 405, headers, { error: "Method not allowed" });
    return;
  }

  try {
    if (!SHARED_SECRET) {
      throw new HttpError(500, "Falta SHARED_SECRET en .env");
    }
    if (!isAuthorized(req)) {
      sendJson(res, 401, headers, { error: "Unauthorized" });
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      throw err instanceof HttpError ? err : new HttpError(400, "No se pudo leer el cuerpo de la solicitud");
    }

    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      throw new HttpError(400, "El cuerpo debe ser JSON válido");
    }

    // Análisis local y determinista (spec 002): no usa IA ni GitHub, así que no pasa por handleAction.
    if (body.action === "analyze_flames") {
      const text = String(body.text || "").slice(0, 4000);
      const author = String(body.author || "").slice(0, 200);
      const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
      const caseId = String(body.caseId || "").slice(0, 120);
      const images = Array.isArray(body.images) ? body.images.filter((u) => typeof u === "string").slice(0, 6) : [];
      const { analysis, ticket } = ops.analyzeMessage({
        caseId,
        messageKey: String(body.messageKey || "").slice(0, 200),
        messageId: String(body.messageId || "").slice(0, 120),
        author,
        text,
        images,
        overrides,
        channel: String(body.channel || "").slice(0, 80),
      });
      const out = { contract: ANALYSIS_CONTRACT, ...analysis };
      if (ticket) out.ticket = { id: ticket.id, number: ticket.number, caseId: ticket.caseId, status: ticket.status };
      sendJson(res, 200, headers, out);
      return;
    }

    // Lista de parques para el selector del panel (spec 004).
    if (body.action === "list_parks") {
      sendJson(res, 200, headers, { contract: ANALYSIS_CONTRACT, parks: parkOptions(loadParks()) });
      return;
    }

    // Foto del ticket (reducida en el navegador): OCR local + palabras clave de la KB (spec 003).
    if (body.action === "read_image") {
      const caseId = canon(body.caseId);
      if (!caseId) throw new HttpError(400, "Falta caseId");
      if (!/^image\/(jpeg|png|webp)$/.test(String(body.mime || ""))) throw new HttpError(400, "Tipo de imagen no permitido (usa jpeg, png o webp)");
      const buf = Buffer.from(String(body.imageBase64 || ""), "base64");
      if (!buf.length) throw new HttpError(400, "Falta la imagen");
      if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, "La imagen es demasiado grande");
      let result;
      try {
        result = await readImage(buf);
      } catch (err) {
        throw new HttpError(502, `No pude leer la foto: ${err.message}`);
      }
      rememberVision(caseId, result);
      try {
        flowLog.onVision(caseId, result);
      } catch (err) {
        console.error("No se pudo escribir el log de visión:", err.message);
      }
      const tk = tickets.findByCase(caseId);
      if (tk) ops.refresh(tk.id); // el ticket se re-evalúa solo con lo que dice la foto
      sendJson(res, 200, headers, { contract: ANALYSIS_CONTRACT, ...result });
      return;
    }

    // Consultas de solo lectura (T-07/T-08): el panel las pide, el lector de cada sistema las atiende.
    if (body.action === "lookup_create") {
      const r = lookups.create({ system: body.system, kind: body.kind, params: body.params || {}, caseId: canon(body.caseId) });
      if (!r.ok) throw new HttpError(400, r.error);
      if (!r.reused && r.job.caseId) {
        try {
          flowLog.onLookupRequested(r.job.caseId, r.job);
        } catch (err) {
          console.error("No se pudo escribir el log de la consulta:", err.message);
        }
      }
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "lookup_next") {
      sendJson(res, 200, headers, { job: lookups.next(String(body.system || "")) });
      return;
    }
    if (body.action === "lookup_result") {
      const job = lookups.get(String(body.id || ""));
      if (!job) throw new HttpError(404, "Consulta no encontrada");
      let data = null;
      if (body.ok && job.system === "gravity" && job.kind === "transaction") data = normalizeGravity(body.data); // lista blanca: nunca datos personales
      const r = lookups.complete(job.id, { ok: !!body.ok, data, error: body.error });
      if (!r.ok) throw new HttpError(409, r.error);
      if (!body.ok && job.caseId) {
        try {
          flowLog.onLookupFailed(job.caseId, { system: job.system, status: "error", error: String(body.error || "").slice(0, 300) });
        } catch (err) {
          console.error("No se pudo escribir el log del error:", err.message);
        }
      }
      if (data && job.caseId) {
        const g = { ...data, requestedReceipt: job.params.receiptNumber };
        rememberGravity(job.caseId, g);
        const tk = tickets.findByCase(job.caseId);
        if (tk) ops.refresh(tk.id); // el ticket se re-evalúa solo con la lectura de Gravity
        try {
          flowLog.onGravity(job.caseId, { receiptNumber: job.params.receiptNumber, gravity: g, evaluation: evaluateGravity({ gravity: g, chatCard: null }) });
        } catch (err) {
          console.error("No se pudo escribir el log de Gravity:", err.message);
        }
      }
      sendJson(res, 200, headers, { ok: true });
      return;
    }
    if (body.action === "lookup_status") {
      const job = lookups.get(String(body.id || ""));
      if (!job) throw new HttpError(404, "Consulta no encontrada");
      if (job.status === "expired" && job.caseId && !expiredLogged.has(job.id)) {
        expiredLogged.add(job.id); // se registra una sola vez
        if (expiredLogged.size > 500) expiredLogged.delete(expiredLogged.values().next().value);
        try {
          flowLog.onLookupFailed(job.caseId, { system: job.system, status: "expired" });
        } catch (err) {
          console.error("No se pudo escribir el log de la consulta caducada:", err.message);
        }
      }
      sendJson(res, 200, headers, { id: job.id, status: job.status, error: job.error });
      return;
    }

    // Consola de tickets (spec 006): corregir, responder, aprobar. Los comandos los ejecuta el listener dentro de Connecteam.
    if (body.action === "ticket_reanalyze") {
      const r = ops.reanalyze({ ticketId: String(body.ticketId || ""), overrides: body.overrides && typeof body.overrides === "object" ? body.overrides : {} });
      if (!r.ok) throw new HttpError(404, r.error);
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "ticket_draft") {
      const r = ops.setDraft({ ticketId: String(body.ticketId || ""), text: String(body.text ?? "") });
      if (!r.ok) throw new HttpError(404, r.error);
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "ticket_reply") {
      const r = ops.reply({ ticketId: String(body.ticketId || ""), text: String(body.text || ""), mode: String(body.mode || "") });
      if (!r.ok) throw new HttpError(400, r.error);
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "ticket_action") {
      const r = ops.act({ ticketId: String(body.ticketId || ""), action: String(body.action_name || body.what || "") });
      if (!r.ok) throw new HttpError(400, r.error);
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "command_next") {
      sendJson(res, 200, headers, { command: commands.next(String(body.target || "")) });
      return;
    }
    if (body.action === "command_result") {
      const r = ops.commandResult({ id: String(body.id || ""), ok: !!body.ok, error: String(body.error || ""), note: String(body.note || "") });
      if (!r.ok) throw new HttpError(409, r.error);
      sendJson(res, 200, headers, r);
      return;
    }
    if (body.action === "command_status") {
      const c = commands.get(String(body.id || ""));
      if (!c) throw new HttpError(404, "Comando no encontrado");
      sendJson(res, 200, headers, { id: c.id, status: c.status, error: c.error, type: c.type });
      return;
    }

    // El panel registra decisiones de Juan (aprobar / negar) y errores en los logs.
    if (body.action === "log_event") {
      try {
        flowLog.onPanelEvent({ ...body, caseId: canon(body.caseId) });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      sendJson(res, 200, headers, { ok: true });
      return;
    }

    const result = await handleAction(body.action, body, env);
    sendJson(res, 200, headers, result);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(err);
    sendJson(res, status, headers, { error: err.message || "Error interno" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`KE Assistant local server escuchando en http://${HOST}:${PORT}`);
  if (!SHARED_SECRET) {
    console.warn("⚠️  Falta SHARED_SECRET en .env — todas las solicitudes serán rechazadas.");
  }
});
