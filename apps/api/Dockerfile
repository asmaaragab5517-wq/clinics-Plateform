# API + worker image (SRS §2.1: API runs in a container, not on Vercel).
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter "@hf/api..." --filter "@hf/worker..."
RUN pnpm --filter "@hf/worker..." build
RUN pnpm deploy --filter @hf/worker --prod --legacy /out/worker && pnpm deploy --filter @hf/api --prod --legacy /out/api

FROM node:22-bookworm-slim
# Chromium for HTML→PDF with Arabic fonts (fonts are also embedded by @hf/documents).
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-hosny-amiri ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* && useradd -r -u 10001 app
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /srv
COPY --from=build /out/api ./apps/api
COPY --from=build /out/worker ./apps/worker
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build /out/api/node_modules ./packages/db/node_modules
USER app
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
