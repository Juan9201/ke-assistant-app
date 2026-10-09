/** Registra en el log la búsqueda real del mensaje de AM John Eason (2026-10-05). */
import { createLog } from "../logs.js";

const t = createLog({ caseId: "busqueda-john-eason", author: "Juan (pedido de búsqueda)", channel: "Gravity Support" });
t.add("input", "Pedido de Juan", "Buscar el mensaje de 'AM John Eason' en el chat.");
t.add("thought", "Plan de búsqueda", "Alcance: solo Connecteam, dentro del chat Gravity Support. No usar la búsqueda general de la barra superior (solo lista usuarios, no mensajes). Estrategia: subir con scroll en la lista virtualizada de mensajes y revisar lo que se carga.");
t.add("action", "Conectar con Connecteam", "Abrir el chat y esperar a que cargue la lista", { system: "connecteam", where: "lista de chats → Gravity Support", query: "abrir canal" });
t.add("evidence", "Lo más reciente", "Hoy solo hay mensajes de CTM Ariana Flores y Manuel Ruiz; último mensaje de soporte: 10:34 AM.", { system: "connecteam" });
t.add("action", "Scroll hacia arriba (1)", "10 pasos de scroll sobre la lista de mensajes; leer remitentes visibles", { system: "connecteam", where: "contenedor virtuoso-scroller de mensajes", query: "John Eason" });
t.add("evidence", "Resultado (1)", "Cargado: ayer 09:17 PM hasta hoy. Sin 'John Eason'.", { system: "connecteam", found: false });
t.add("action", "Scroll hacia arriba (2 y 3)", "20 pasos más de scroll", { system: "connecteam", where: "contenedor virtuoso-scroller de mensajes", query: "John Eason" });
t.add("evidence", "Resultado (2 y 3)", "Cargado: ayer ~08:55 PM hasta hoy. Sin 'John Eason'. El canal mueve decenas de mensajes por hora; subir así es lento.", { system: "connecteam", found: false });
t.add("action", "Búsqueda dentro del chat", "Lupa del encabezado del chat: escribir 'John Eason' y Enter", { system: "connecteam", where: "panel 'Search messages in chat'", query: "John Eason" });
t.add("error", "La búsqueda interna no responde", "El panel quedó cargando más de 15 segundos sin resultados; se cerró el panel.", { system: "connecteam", waitedSeconds: 15 });
t.add("decision", "Conclusión", "Con el historial revisado (~desde ayer 8:55 PM) no está el mensaje. Hace falta una pista: hora aproximada o parte del texto.");
t.add("escalation", "Se pide dato a Juan", "Hora aproximada o texto del mensaje de AM John Eason", { category: "falta_dato" });
t.end("asked_missing_data", "Mensaje de AM John Eason no encontrado en el historial reciente");
console.log("Log escrito.");
