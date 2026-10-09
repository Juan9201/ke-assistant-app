/** Caso real: AM John Eason pide cargar una tarjeta de prueba (2026-10-04). Ya estaba atendido. */
import { createLog } from "../logs.js";

const t = createLog({ caseId: "tarjeta-test-john-eason", author: "AM John Eason", channel: "Gravity Support", park: "Arlington" });
t.add("input", "Mensaje", "Hello Arlington, can you load a test card please 3968122745", { time: "06:55 PM (ayer)" });
t.add("match", "Matching", "Calzó 'test' + 'card' → módulo playcard.md, sección Tarjetas de prueba (omite la revisión en Gravity)", { terms: ["test", "card"] });
t.add("extract", "Datos hallados", "Parque al inicio del mensaje; tarjeta de 10 dígitos", { park: "Arlington", card: "3968122745" });
t.add("check", "V1 formato", "10 dígitos exactos: OK", { ok: true });
t.add("decision", "Gravity", "Condición test+card: no se valida recibo en Gravity", { skipGravity: true });
t.add("action", "Revisar si ya se atendió (chat)", "Buscar respuestas posteriores que citen el mensaje", { system: "connecteam", where: "Gravity Support", query: "3968122745" });
t.add("evidence", "Ya respondido en el chat", "Silvia Hernandez: 'Hello John, on it' (06:56 PM) y 'Successfully added 50.00 Credits to the Card : 3968122745' (07:01 PM)", { system: "connecteam", answered: true });
t.add("action", "Revisar la tarjeta en Amusement", "cardScanReports de la tarjeta, tabla Kiosk Transactions", { system: "amusement", where: "cardScanReports", query: "3968122745" });
t.add("evidence", "Recarga existente", "Kids Empire - TX - Arlington Manual Kiosk | $10.00 | CREDIT | 50.00 | Reload Card | customercare@kidsempire.us", { system: "amusement", flames: 50 });
t.add("decision", "Política", "Ya está cargada: no se recarga de nuevo (anti doble recarga). Sin respuesta nueva en el chat.");
t.end("answered", "Ya atendido el 2026-10-04 07:01 PM; sin acción");
console.log("Log escrito.");
