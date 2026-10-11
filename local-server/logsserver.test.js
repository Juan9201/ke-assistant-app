import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLog } from "./logs.js";
import { handleLogsRequest } from "./logsserver.js";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ke-ts-"));
  const t = createLog({ caseId: "x1", author: "AM Test" }, { dir });
  t.add("input", "Mensaje", "hola");
  t.end("answered");
  const viewer = path.join(dir, "viewer.html");
  fs.writeFileSync(viewer, "<html>visor</html>");
  const server = http.createServer((req, res) => {
    if (!handleLogsRequest(req, res, { dir, viewerPath: viewer })) {
      res.writeHead(404);
      res.end("no");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

function get(port, p, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, headers: { Host: host || `127.0.0.1:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("CA-05: /api/logs devuelve los casos y no manda cabeceras CORS", async () => {
  const { server, port } = await setup();
  const r = await get(port, "/api/logs");
  server.close();
  assert.equal(r.status, 200);
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  const data = JSON.parse(r.body);
  assert.equal(data.cases.length, 1);
  assert.equal(data.cases[0].id, "x1");
  assert.equal(data.cases[0].events.at(-1).outcome, "answered");
});

test("/logs sirve el visor", async () => {
  const { server, port } = await setup();
  const r = await get(port, "/logs");
  server.close();
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /visor/);
});

test("CA-06: un Host externo recibe 403", async () => {
  const { server, port } = await setup();
  const r = await get(port, "/api/logs", "evil.example.com");
  server.close();
  assert.equal(r.status, 403);
});

test("una ruta que no es de logs no se atiende", async () => {
  const { server, port } = await setup();
  const r = await get(port, "/otra");
  server.close();
  assert.equal(r.status, 404);
});

test("la ruta vieja /traces ya no existe", async () => {
  const { server, port } = await setup();
  const r = await get(port, "/traces");
  server.close();
  assert.equal(r.status, 404);
});
