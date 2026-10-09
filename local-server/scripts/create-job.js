/**
 * Crea un trabajo de recarga en la cola del servidor local. NO mueve valor: el userscript del
 * Manual Kiosk lo toma, prepara la pantalla y deja el botón "Aprobar y cargar" a una persona.
 *
 * Uso (desde local-server/):
 *   node scripts/create-job.js --card 1325951879 --park Arlington --location 4809 --flames 50
 *   node scripts/create-job.js --card 1325951879 --park Chandler --location 2364 --flames 24 --reason webhook_failed --request id-del-mensaje
 *
 * Lee SHARED_SECRET de .env (no lo imprime). Los dólares se deducen de la tabla vista en el kiosk;
 * si los flames no están en la tabla, pasa --usd.
 */
import "dotenv/config";

const USD_BY_FLAMES = { 5: 1.25, 24: 5, 50: 10, 102: 20, 125: 25, 250: 50 };

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) out[a[i].replace(/^--/, "")] = a[i + 1];
  return out;
}

const o = args();
const flames = Number(o.flames);
const usd = o.usd ? Number(o.usd) : USD_BY_FLAMES[flames];
if (!o.card || !o.park || !o.location || !flames || !usd) {
  console.error("Faltan datos. Requeridos: --card --park --location --flames (y --usd si los flames no están en la tabla).");
  process.exit(1);
}

const job = {
  card: String(o.card),
  parkName: o.park,
  locationId: Number(o.location),
  flames,
  amountUsd: usd,
  requestId: o.request || `manual-${Date.now()}`,
  reason: o.reason || "test_card",
  author: o.author || "Juan",
};

const base = `http://127.0.0.1:${process.env.PORT || 8787}`;
const res = await fetch(base, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shared-Secret": process.env.SHARED_SECRET || "" },
  body: JSON.stringify({ action: "job_create", job }),
});
const data = await res.json().catch(() => ({}));
if (data.ok) console.log(`Trabajo creado: ${data.job.id} (${job.flames} flames → ${job.card} en ${job.parkName}, $${job.amountUsd})`);
else console.error(`No se creó: ${data.error || `HTTP ${res.status}`}`);
