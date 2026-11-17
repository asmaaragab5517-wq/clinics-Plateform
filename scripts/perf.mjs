#!/usr/bin/env node
/**
 * NFR-2 smoke load test without extra tools (k6 remains the staging test: infra/load/k6-booking.js).
 * Runs N concurrent virtual users for D seconds against the public API and prints p50/p95/p99 per endpoint.
 * Usage: API=http://localhost:4000 ORG=demo VUS=200 DURATION=30 node scripts/perf.mjs
 */
const API = process.env.API ?? 'http://localhost:4000';
const ORG = process.env.ORG ?? 'demo';
const VUS = Number(process.env.VUS ?? 200);
const DURATION = Number(process.env.DURATION ?? 30) * 1000;
const headers = { 'x-org': ORG };

const doctors = await (await fetch(`${API}/v1/public/doctors`, { headers })).json();
if (!Array.isArray(doctors) || !doctors.length) throw new Error('no doctors returned - is the API seeded?');
const targets = {
  slots: () => `/v1/public/slots?doctorId=${doctors[Math.floor(Math.random() * doctors.length)].id}`,
  doctors: () => '/v1/public/doctors?specialty=internal-medicine',
  doctor: () => `/v1/public/doctors/${doctors[Math.floor(Math.random() * doctors.length)].slug}`,
  clinics: () => '/v1/public/clinics',
};
const thresholds = { slots: 300, doctors: 400, doctor: 400, clinics: 400 };
const lat = Object.fromEntries(Object.keys(targets).map((k) => [k, []]));
let errors = 0;
const end = Date.now() + DURATION;
const names = Object.keys(targets);

async function vu() {
  while (Date.now() < end) {
    const name = names[Math.floor(Math.random() * names.length)];
    const t0 = performance.now();
    try {
      const r = await fetch(API + targets[name](), { headers });
      await r.arrayBuffer();
      if (r.status >= 400) errors++;
    } catch {
      errors++;
    }
    lat[name].push(performance.now() - t0);
  }
}
await Promise.all(Array.from({ length: VUS }, vu));
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] ?? 0;
let failed = false;
const total = Object.values(lat).reduce((a, l) => a + l.length, 0);
console.log(`VUs ${VUS}, ${DURATION / 1000}s, ${total} requests (${Math.round(total / (DURATION / 1000))}/s), errors ${errors}`);
for (const [k, a] of Object.entries(lat)) {
  const p95 = Math.round(pct(a, 95));
  const ok = p95 < thresholds[k];
  if (!ok) failed = true;
  console.log(`${k.padEnd(8)} n=${String(a.length).padStart(6)} p50=${Math.round(pct(a, 50))}ms p95=${p95}ms p99=${Math.round(pct(a, 99))}ms target<${thresholds[k]}ms ${ok ? 'OK' : 'FAIL'}`);
}
process.exit(failed || errors / Math.max(1, total) > 0.01 ? 1 : 0);
