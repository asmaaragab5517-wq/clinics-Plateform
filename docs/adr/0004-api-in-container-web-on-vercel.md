# ADR 0004: API and worker in containers; web tier on Vercel

- Status: accepted (SRS §2.1)

The API needs long-running workers, headless Chromium for PDFs, SSE for queue screens, webhook retries and data-residency
control (D1). It runs as a container on App Platform (`infra/terraform`). `apps/site` and `apps/console` are Next.js
projects on Vercel with separate domains and cookies; their route handlers act as a BFF so tokens stay in httpOnly
cookies and no PHI is cached on Vercel.
