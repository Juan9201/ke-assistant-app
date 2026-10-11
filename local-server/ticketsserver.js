/**
 * Rutas de la consola de tickets (spec 006):
 *   GET /tickets            → la página (con el secreto inyectado: sus acciones de escritura lo exigen)
 *   GET /api/tickets        → { tickets: [...] }  (resúmenes, por orden de llegada)
 *   GET /api/tickets/{id}   → { ticket, logs }    (el ticket completo y los logs de su caso)
 *
 * Seguridad: sin cabeceras CORS (otra web no puede leerlas) y solo con Host 127.0.0.1 o localhost (evita DNS-rebinding).
 * Devuelve true si atendió la petición, false si la ruta no es suya.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCaseEvents } from "./logs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_UI = path.join(HERE, "..", "tickets-ui", "tickets.html");
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function handleTicketsRequest(req, res, { tickets, logsDir, secret = "", uiPath = DEFAULT_UI } = {}) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const detail = p.match(/^\/api\/tickets\/([A-Za-z0-9_-]{1,40})$/);
  if (req.method !== "GET" || !(p === "/tickets" || p === "/api/tickets" || detail)) return false;

  if (!LOCAL_HOST.test(String(req.headers.host || ""))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }

  if (p === "/tickets") {
    try {
      const html = fs.readFileSync(uiPath, "utf8").replaceAll("__SHARED_SECRET__", secret);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No se encontró la consola (tickets-ui/tickets.html)");
    }
    return true;
  }

  const json = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
    return true;
  };
  if (p === "/api/tickets") return json(200, { tickets: tickets.list() });

  const t = tickets.get(detail[1]);
  if (!t) return json(404, { error: "Ticket no encontrado" });
  return json(200, { ticket: t, logs: loadCaseEvents([t.caseId, ...t.aliases], logsDir) });
}
