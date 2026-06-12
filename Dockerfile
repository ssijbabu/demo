# syntax=docker/dockerfile:1.7

# ── Stage 1: build frontend + backend ─────────────────────────────────────────
FROM node:24.14.1-bookworm-slim AS build

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev

ENV PYTHON=/usr/bin/python3
WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json backstage.json ./
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/app/package.json     ./packages/app/package.json

RUN --mount=type=cache,target=/root/.cache/yarn,sharing=locked \
    yarn install --immutable

COPY packages    ./packages
COPY plugins     ./plugins
COPY examples    ./examples
COPY tsconfig.json ./
COPY app-config.yaml app-config.production.yaml ./

RUN yarn tsc && yarn build:all

# ── Stage 2: production dependencies (native modules compiled here) ────────────
FROM node:24.14.1-bookworm-slim AS prod-deps

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev tini

ENV PYTHON=/usr/bin/python3
WORKDIR /app

COPY .yarn ./.yarn
COPY .yarnrc.yml backstage.json ./

COPY --from=build /app/yarn.lock /app/package.json ./
COPY --from=build /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/root/.cache/yarn,sharing=locked \
    yarn workspaces focus --all --production

# ── Stage 3: assemble /app (distroless has no shell or tar) ───────────────────
FROM node:24.14.1-bookworm-slim AS staging

WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/package.json ./
COPY --from=prod-deps /app/packages    ./packages

COPY --from=build /app/packages/backend/dist/bundle.tar.gz ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

COPY --from=build /app/app-config.yaml /app/app-config.production.yaml ./
COPY examples ./examples

# ── Stage 4: distroless runtime — no shell, no package manager, no compiler ───
FROM gcr.io/distroless/nodejs24-debian12:nonroot

ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"

WORKDIR /app

# tini for PID 1: proper SIGTERM forwarding and zombie reaping
COPY --from=prod-deps /usr/bin/tini /tini

# Application — owned by distroless nonroot (uid 65532)
COPY --chown=65532:65532 --from=staging /app .

EXPOSE 7007

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", \
         "require('http').get('http://localhost:7007/.backstage/health/v1/readiness',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

ENTRYPOINT ["/tini", "--", "/nodejs/bin/node"]
CMD ["packages/backend", \
     "--config", "app-config.yaml", \
     "--config", "app-config.production.yaml"]
