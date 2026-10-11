/**
 * Genera logs de ejemplo (con datos FICTICIOS) en data/logs/ para probar el visor.
 * Uso: node scripts/demo-log.js
 */
import { createLog } from "../logs.js";

const t = createLog({ caseId: "demo-1", author: "AM Persona Ejemplo", channel: "Gravity Support" });
t.add("input", "Mensaje con foto", "hello, i have a customers playcard here and she purchased the $20 flame [pc number (0000000001)], can we get those loaded?", { hasImage: true });
t.add("match", "Matching", "Calzó: 'playcard', 'flame'. Módulo: playcard.md", { terms: ["playcard", "flame"] });
t.add("thought", "Lo que entiendo", "El staff pide cargar flames a una tarjeta. La foto del ticket trae el Receipt ID y el monto; el texto trae la tarjeta.");
t.add("extract", "Datos hallados", "Tarjeta del texto, Receipt ID de la imagen", { card: "0000000001", receipt_id: "00000001", park: "Arlington" });
t.add("check", "V1 formato", "La tarjeta tiene 10 dígitos: OK", { ok: true });
t.add("action", "Gravity: buscar recibo", "venue 225 → pos-transaction → #00000001", { system: "gravity" });
t.add("evidence", "Recibo encontrado", "$20 = 102 flames, pagado con crédito; sin campo PLAY_CARD", { flames: 102 });
t.add("check", "V2 coincidencia", "No se puede validar: el recibo no trae PLAY_CARD", { ok: false });
t.add("decision", "Política", "playcard.md: recibo sin PLAY_CARD → no recargar, escalar a Juan");
t.add("escalation", "Escalado", "Allow me take a look", { category: "recibo_sin_play_card" });
t.end("escalated", "Recibo sin PLAY_CARD");

const u = createLog({ caseId: "demo-2", author: "M Otra Persona" });
u.add("input", "Mensaje", "Playcard 080045039 has no flames");
u.add("check", "V1 formato", "9 dígitos: falta 1", { ok: false, length: 9 });
u.add("reply", "Respuesta propuesta", "Sorry... But would it be possible to double check the sequence number? It looks like it is missing 1 digit(s). Please?");
u.end("asked_missing_data", "Tarjeta con 9 dígitos");

console.log("Logs de ejemplo escritos en data/logs/. Abre logs-viewer/logs.html y carga el archivo del día.");
