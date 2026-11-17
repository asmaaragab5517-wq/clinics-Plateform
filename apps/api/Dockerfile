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
# Production dependencies only, from the same lockfile (exact versions the tests ran against), offline from the store.
RUN rm -rf node_modules packages/*/node_modules apps/*/node_modules \
  && pnpm install --frozen-lockfile --prod --offline --filter "@hf/api..." --filter "@hf/worker..." \
  && rm -rf packages/*/src apps/*/src packages/*/test apps/*/test

FROM node:22-bookworm-slim
# Chromium for HTML→PDF with Arabic fonts (fonts are also embedded by @hf/documents).
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core fonts-hosny-amiri ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* && useradd -r -u 10001 app
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /srv
# The workspace layout is kept so pnpm's node_modules links resolve (packages/*, apps/api, apps/worker).
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api ./apps/api
COPY --from=build /repo/apps/worker ./apps/worker
USER app
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
