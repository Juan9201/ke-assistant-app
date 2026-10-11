/**
 * Construye kb/data/parks.json emparejando las instantáneas de Gravity y Amusement (spec 004).
 *
 *   node tools/parks-sync/build-parks.mjs
 *
 * Entradas (las produce la lectura de solo lectura con la sesión de Juan):
 *   kb/data/parks-gravity.txt     venueId|nombre|ciudad?
 *   kb/data/parks-amusement.txt   locationId|nombre
 * Salida: kb/data/parks.json + un reporte de lo que no se pudo emparejar solo.
 * No contiene credenciales ni datos personales.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "kb", "data");
const MAIN_ORG = "5fc8c6e2-3007-4089-b481-544c3168e358";
const MORENO_ORG = "f48e2a80-02da-446b-8085-054df291692f";

// Emparejamientos que el algoritmo no puede deducir por nombre (nombre en Gravity → locationId de Amusement).
const OVERRIDES = {
  "AZ-Gilbert": 1074,
  "AZ-Phoenix Laveen": 1290,
  "CA-Fresno Riverpark": 2470,
  "CA-Escondido North Country Mall": 4441,
  "CO-Aurora Southlands": 4719,
  "CO-CO Springs": 1496,
  "FL-Miami": 1050,
  "FL-Tampa Bradenton": 2586,
  "FL-West Palm": 1523,
  "GA-Marietta": 1097,
  "GA-Rivermont": 1096,
  "IA-Jordan Creek West Des Moines": 1443,
  "IA-Merle Hay Des Moines": 1468,
  "IL-Palatine Deer Grove": 1501,
  "IN-FT Wayne": 1525,
  "MD-Arundel": 1527,
  "MN-Bloomington Valley West": 1444,
  "NC-Charlotte Northlake Mall": 4417,
  "NM-Albuquerque Cottonwood Mall": 2699,
  "OH-Akron Fairlawn Summit Mall": 4416,
  "OH-Olmsted": 2165,
  "OH-Strongsville SouthPark Mall": 2735,
  "TX-Dallas Hillcrest": 1104,
  "TX-Houston Garden Center": 1107,
  "TX-Houston Katy": 1532,
  "WI-Bayshore": 2173,
  // CA-Moreno Valley vive en otra organización de Amusement; su locationId se completa aparte.
};
// CA-Moreno Valley: locationId 1432 en la organización f48e2a80-… (leído al cambiar de organización en el Manual Kiosk, 2026-10-09).
const MORENO_LOCATION_ID = 1432;

const readLines = (f) =>
  fs.readFileSync(path.join(DATA, f), "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));

const gravity = readLines("parks-gravity.txt").map((l) => {
  const [id, name, city = ""] = l.split("|");
  const inactive = id.startsWith("~");
  return { venueId: Number(id.replace("~", "")), code: name.trim(), city: city.trim(), inactive };
});
const amusement = readLines("parks-amusement.txt")
  .map((l) => {
    const [id, name] = l.split("|");
    return { locationId: Number(id), code: name.trim() };
  })
  .filter((a) => /^[A-Z]{2}-/.test(a.code)); // descarta "Shop Location - Kids Empire"

const state = (code) => code.slice(0, 2);
const rest = (code) => code.slice(3).trim();
const tokens = (s) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !["mall", "village", "park", "center"].includes(t));

function score(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((t) => B.has(t)).length;
  return inter / Math.min(A.size, B.size);
}

const used = new Set();
const matches = new Map(); // venueId -> { amusement, how, score }
const byLocation = new Map(amusement.map((a) => [a.locationId, a]));

for (const g of gravity) {
  const ov = OVERRIDES[g.code];
  if (ov) {
    const a = byLocation.get(ov);
    if (a) {
      matches.set(g.venueId, { a, how: "manual", score: 1 });
      used.add(ov);
    }
  }
}
for (const g of gravity) {
  if (matches.has(g.venueId)) continue;
  const cands = amusement
    .filter((a) => state(a.code) === state(g.code) && !used.has(a.locationId))
    .map((a) => {
      const byName = score(rest(g.code), rest(a.code));
      const exact = rest(g.code).toLowerCase() === rest(a.code).toLowerCase();
      // La ciudad solo ayuda cuando el nombre no se parece (y vale menos), para no empatar con otros parques de la misma ciudad.
      const byCity = byName < 0.5 && g.city ? score(g.city, rest(a.code)) * 0.9 : 0;
      return { a, s: exact ? 2 : Math.max(byName, byCity) };
    })
    .sort((x, y) => y.s - x.s);
  if (cands.length && cands[0].s >= 0.5 && (cands.length === 1 || cands[0].s > cands[1].s)) {
    matches.set(g.venueId, { a: cands[0].a, how: "nombre", score: cands[0].s });
    used.add(cands[0].a.locationId);
  }
}

// --- Alias para reconocer el parque en el texto del chat (solo los que no chocan con otro parque).
const STOP = new Set(["north", "south", "east", "west", "park", "mall", "center", "hills", "heights", "city", "village", "lake", "falls", "valley", "new", "san", "las", "los", "fort", "ft", "springs", "creek"]);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const raw = gravity.map((g) => {
  const m = matches.get(g.venueId);
  // Alias propios: el nombre del parque tal cual (Gravity y Amusement). Siempre cuentan.
  const own = new Set([norm(rest(g.code)), norm(g.code)]);
  if (m) own.add(norm(rest(m.a.code)));
  // La ciudad solo es alias si ningún otro parque la lleva en su código (p. ej. "houston" no sirve: hay varios).
  if (g.city && !gravity.some((o) => o !== g && norm(o.code).includes(norm(g.city)))) own.add(norm(g.city));
  // Alias parciales (derivados): "houston westchase" -> "westchase". Solo valen si ningún otro parque los tiene.
  const partial = new Set();
  const t = tokens(rest(g.code));
  if (t.length >= 2) {
    partial.add(t.slice(1).join(" "));
    partial.add(t[t.length - 1]);
  }
  const ok = (n) => n.length >= 4 && !STOP.has(n);
  return { g, m, own: [...own].filter(ok), partial: [...partial].filter(ok) };
});
const ownCount = new Map();
const allCount = new Map();
for (const r of raw) {
  for (const n of new Set(r.own)) ownCount.set(n, (ownCount.get(n) || 0) + 1);
  for (const n of new Set([...r.own, ...r.partial])) allCount.set(n, (allCount.get(n) || 0) + 1);
}

const parks = raw.map(({ g, m, own, partial }) => {
  const isMoreno = g.code === "CA-Moreno Valley";
  return {
    code: g.code,
    state: state(g.code),
    name: rest(g.code),
    gravityVenueId: g.venueId,
    amusementLocationId: isMoreno ? MORENO_LOCATION_ID : m ? m.a.locationId : null,
    amusementOrganizationId: isMoreno ? MORENO_ORG : MAIN_ORG,
    active: !g.inactive,
    // aliases = nombre propio (gana a los parciales de otros parques); partialAliases = derivados, solo si son únicos.
    aliases: [...new Set(own)].filter((n) => ownCount.get(n) === 1).sort(),
    partialAliases: [...new Set(partial)].filter((n) => allCount.get(n) === 1).sort(),
  };
});

fs.writeFileSync(
  path.join(DATA, "parks.json"),
  JSON.stringify({ generatedAt: new Date().toISOString().slice(0, 10), source: "Gravity /api/companies/1/venues + Amusement #location-selector", parks }, null, 2) + "\n",
);

// --- Lista legible para humanos (kb/docs/parks.md)
const sinPareja = amusement.filter((a) => !used.has(a.locationId));
const esc = (v) => (v == null ? "—" : v);
const md = [
  "# Parques",
  "",
  "> Generado por `tools/parks-sync/build-parks.mjs` a partir de Gravity y Amusement (" + new Date().toISOString().slice(0, 10) + "). **No editar a mano**: se regenera cada lunes (spec 004).",
  "> Fuente de las máquinas: `kb/data/parks.json`. No contiene credenciales.",
  "",
  "| # | Parque (código en Gravity) | Venue Gravity | locationId Amusement | Organización Amusement |",
  "|---|---|---|---|---|",
  ...parks.map((p, i) => "| " + (i + 1) + " | " + p.code + " | " + p.gravityVenueId + " | " + esc(p.amusementLocationId) + " | " + (p.amusementOrganizationId === MAIN_ORG ? "Kids Empire" : "Kids Empire-CA-Moreno Valley") + " |"),
  "",
  "**" + parks.length + " parques en Gravity.** En Amusement hay " + sinPareja.length + " ubicación(es) sin pareja en Gravity: " + (sinPareja.map((a) => a.code + " (" + a.locationId + ")").join(", ") || "ninguna") + ".",
  "",
  "Cómo se obtiene: Gravity → `GET /api/companies/1/venues` (id y nombre de cada venue); Amusement → desplegable `#location-selector` del Manual Kiosk (locationId numérico). Con la sesión de Juan, solo lectura.",
  "URL de Gravity: `https://access.thegravityapp.io/company/1/venue/{venueId}` · URL de Amusement: `https://app.amusementconnect.com/ManualKiosk/ManualKiosk?locationId={locationId}&organizationId={org}`.",
  "",
].join("\n");
fs.writeFileSync(path.join(ROOT, "kb", "docs", "parks.md"), md);

// --- Reporte
const sinAmusement = parks.filter((p) => p.amusementLocationId == null);
const huerfanos = amusement.filter((a) => !used.has(a.locationId));
const dudosos = [...matches.entries()].filter(([, v]) => v.how === "nombre" && v.score < 1).map(([id, v]) => `${gravity.find((g) => g.venueId === id).code} ≈ ${v.a.code} (${v.a.locationId}, ${v.score.toFixed(2)})`);
console.log(`Gravity: ${gravity.length} · Amusement (sin Shop): ${amusement.length} · emparejados: ${matches.size}`);
console.log(`\nSin locationId de Amusement (${sinAmusement.length}):\n  ` + (sinAmusement.map((p) => p.code).join("\n  ") || "—"));
console.log(`\nEn Amusement y sin pareja en Gravity (${huerfanos.length}):\n  ` + (huerfanos.map((a) => `${a.locationId} ${a.code}`).join("\n  ") || "—"));
console.log(`\nEmparejados por nombre con similitud < 1 (revisar):\n  ` + (dudosos.join("\n  ") || "—"));
