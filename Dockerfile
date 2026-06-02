# syntax=docker/dockerfile:1.7
# Multi-stage build — runs entirely inside Docker, no local pre-build required.
#
# Usage:
#   docker build -t backstage .
#   docker run -p 7007:7007 --env-file .env backstage
#
# For production with PostgreSQL:
#   docker compose up

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: build frontend + backend
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-trixie-slim AS build

# Native module build deps (isolate-vm, better-sqlite3, etc.)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev

ENV PYTHON=/usr/bin/python3

WORKDIR /app

# Copy Yarn setup first for layer caching
COPY .yarn ./.yarn
COPY .yarnrc.yml yarn.lock package.json backstage.json ./

# Copy all package manifests so Yarn can resolve the workspace graph
COPY packages/backend/package.json  ./packages/backend/package.json
COPY packages/app/package.json      ./packages/app/package.json

RUN --mount=type=cache,target=/root/.cache/yarn,sharing=locked \
    yarn install --immutable

# Copy source
COPY packages ./packages
COPY plugins  ./plugins
COPY examples ./examples
COPY tsconfig.json ./
COPY app-config.yaml app-config.production.yaml ./

# Type-check and build everything (frontend bundle + backend bundle)
RUN yarn tsc && yarn build:all

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: lean runtime image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-trixie-slim

ENV PYTHON=/usr/bin/python3
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"

# Runtime native deps
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev

USER node
WORKDIR /app

# Yarn runtime
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml backstage.json ./

# Install production dependencies only via the skeleton produced by the build stage
COPY --chown=node:node --from=build /app/yarn.lock /app/package.json ./
COPY --chown=node:node --from=build /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# Catalog example entities
COPY --chown=node:node examples ./examples

# Backend bundle + config
COPY --chown=node:node --from=build /app/packages/backend/dist/bundle.tar.gz ./
COPY --chown=node:node --from=build /app/app-config.yaml /app/app-config.production.yaml ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

EXPOSE 7007

CMD ["node", "packages/backend", \
     "--config", "app-config.yaml", \
     "--config", "app-config.production.yaml"]
