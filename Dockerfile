FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@12.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build && pnpm --filter api build


FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN npm install -g pnpm@12.15.0
ENV NODE_ENV=production

# Dependências de produção da API
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter api

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist

ENV WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app/apps/api
USER node
CMD ["node", "dist/server.js"]
