/**
 * Rutas de solo lectura para ver los logs (spec 001, R-08 y R-09):
 *   GET /logs       → el visor (HTML)
 *   GET /api/logs   → { cases: [...] }
 *
 * Seguridad: no se envían cabeceras CORS (otra página web no puede leer estas rutas desde
 * el navegador) y solo se acepta Host 127.0.0.1 o localhost (evita DNS-rebinding).
 * Devuelve true si atendió la petición, false si la ruta no es suya.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLogs } from "./logs.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VIEWER = path.join(HERE, "..", "logs-viewer", "logs.html");

const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;

export function handleLogsRequest(req, res, { dir, viewerPath = DEFAULT_VIEWER } = {}) {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" || (url.pathname !== "/logs" && url.pathname !== "/api/logs")) return false;

  if (!LOCAL_HOST.test(String(req.headers.host || ""))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }

  if (url.pathname === "/logs") {
    try {
      const html = fs.readFileSync(viewerPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No se encontró el visor (logs-viewer/logs.html)");
    }
    return true;
  }

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ cases: loadLogs(dir) }));
  return true;
}
