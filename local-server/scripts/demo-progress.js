/**
 * Demo de la barra de progreso y el cronómetro (datos FICTICIOS, sin tocar ningún sistema).
 * Uso: node scripts/demo-progress.js   (tarda ~12 s; mira http://127.0.0.1:8787/logs mientras corre)
 */
import { createLog } from "../logs.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = createLog({ caseId: `demo-progreso-${Date.now()}`, author: "AM Persona Ejemplo (demo)", channel: "Gravity Support" });

const PASOS = [
  ["Buscar el mensaje en Gravity Support", 1800, { system: "connecteam", where: "lista de mensajes", query: "test + card" }],
  ["Leer autor y parque", 700],
  ["Validar la tarjeta (10 dígitos)", 400],
  ["Comprobar que no esté ya cargada", 2200, { system: "amusement", where: "cardScanReports", query: "tarjeta" }],
  ["Abrir el Manual Kiosk del parque", 1500, { system: "amusement", where: "ManualKiosk", query: "parque" }],
  ["Preparar Reload Card, tarjeta y monto", 2600, { system: "amusement", where: "formulario", query: "créditos == flames" }],
  ["Esperar la aprobación de una persona", 2000],
  ["Verificar la fila nueva", 1500, { system: "amusement", where: "cardScanReports", query: "Reload Card" }],
];

t.add("input", "Demo", "Mensaje ficticio con 'test' y 'card'");
for (let i = 0; i < PASOS.length; i++) {
  const [label, ms, action] = PASOS[i];
  t.step(i + 1, PASOS.length, label, "start");
  if (action) t.add("action", label, "", action);
  await sleep(ms);
  t.step(i + 1, PASOS.length, label, "done");
}
t.end("prepared_for_human", "Demo completada (sin mover valor)");
console.log("Demo terminada.");
