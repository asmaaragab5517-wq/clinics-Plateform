# Patient website (apps/site) or staff console (apps/console) as a Next.js standalone server, for hosts that run
# containers (Railway staging). Build with --build-arg APP=site|console. Vercel builds these apps without this file.
FROM node:22-bookworm-slim AS build
ARG APP
# Inlined into the browser bundle at build time (site only); set it as a service variable on the host.
ARG NEXT_PUBLIC_SITE_URL
RUN test "$APP" = site || test "$APP" = console
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/${APP} ./apps/${APP}
RUN pnpm install --frozen-lockfile --filter "@hf/${APP}..."
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter "@hf/${APP}^..." build && pnpm --filter "@hf/${APP}" build
# Standalone output keeps the workspace layout: server.js sits under apps/<app>/.
RUN mkdir -p /out && cp -r apps/${APP}/.next/standalone/. /out/ \
  && mkdir -p /out/apps/${APP}/.next && cp -r apps/${APP}/.next/static /out/apps/${APP}/.next/static \
  && cp -r apps/${APP}/public /out/apps/${APP}/public

FROM node:22-bookworm-slim
ARG APP
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/* && useradd -r -u 10001 app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 APP=${APP}
WORKDIR /srv
COPY --from=build --chown=app /out ./
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec node apps/$APP/server.js"]
