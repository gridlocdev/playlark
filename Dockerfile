# Playlark for a NAS (PRD §18): builds the web client, then runs the Node server, which has no dependencies
# outside this workspace.
FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @playlark/web...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/ui packages/ui
COPY apps/web apps/web
RUN pnpm --filter @playlark/web build

FROM node:22-alpine AS server
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/node-files/package.json packages/node-files/
COPY apps/server/package.json apps/server/
RUN pnpm install --prod --frozen-lockfile --filter @playlark/server...
COPY packages/core/src packages/core/src
COPY packages/node-files/src packages/node-files/src
COPY apps/server/src apps/server/src
COPY --from=build /src/apps/web/dist apps/web/dist

FROM node:22-alpine
ENV NODE_ENV=production \
    PLAYLARK_MUSIC=/music \
    PLAYLARK_DATA=/data \
    PLAYLARK_HOST=0.0.0.0 \
    PLAYLARK_PORT=8830 \
    PLAYLARK_STATIC=/app/apps/web/dist
WORKDIR /app
COPY --from=server /app /app
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8830
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8830/api/info >/dev/null || exit 1
CMD ["node", "apps/server/src/main.ts"]
