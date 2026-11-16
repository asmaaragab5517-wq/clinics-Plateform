// NFR-2 load test: 200 concurrent users; slot search p95 < 300 ms, API p95 < 400 ms.
// Run: k6 run -e API=https://staging-api.example -e ORG=demo infra/load/k6-booking.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: { browse: { executor: 'constant-vus', vus: 200, duration: '5m' } },
  thresholds: {
    'http_req_duration{name:slots}': ['p(95)<300'],
    'http_req_duration{name:doctors}': ['p(95)<400'],
    'http_req_duration{name:doctor}': ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
  },
};

const API = __ENV.API || 'http://localhost:4000';
const headers = { 'x-org': __ENV.ORG || 'demo' };

export function setup() {
  const doctors = http.get(`${API}/v1/public/doctors`, { headers }).json();
  return { doctors: doctors.map((d) => ({ id: d.id, slug: d.slug })) };
}

export default function (data) {
  const list = http.get(`${API}/v1/public/doctors?specialty=internal-medicine`, { headers, tags: { name: 'doctors' } });
  check(list, { 'doctors 200': (r) => r.status === 200 });
  const d = data.doctors[Math.floor(Math.random() * data.doctors.length)];
  if (!d) return;
  const prof = http.get(`${API}/v1/public/doctors/${d.slug}`, { headers, tags: { name: 'doctor' } });
  check(prof, { 'doctor 200': (r) => r.status === 200 });
  const slots = http.get(`${API}/v1/public/slots?doctorId=${d.id}`, { headers, tags: { name: 'slots' } });
  check(slots, { 'slots 200': (r) => r.status === 200 });
  sleep(1);
}
