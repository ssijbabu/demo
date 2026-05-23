# Backstage Demo

A scaffolded Backstage developer portal instance using the new frontend and backend system APIs.

## Versions

| Tool | Version |
|------|---------|
| Backstage | 1.51.0 |
| Node.js | 22 or 24 |
| TypeScript | ~5.8.0 |
| React | ^18.0.2 |
| React Router | ^6.30.2 |
| Material UI | ^4.12.2 |
| Jest | ~30.2.0 |
| Playwright | ^1.32.3 |
| Prettier | ^2.3.2 |
| `@backstage/cli` | ^0.36.2 |

## Project Structure

```
demo/
├── packages/
│   ├── app/        # Frontend (React, new declarative frontend system)
│   └── backend/    # Backend (new backend system with createBackend())
├── plugins/        # Custom plugins (currently empty)
├── examples/       # Sample catalog entities, templates, org data
├── app-config.yaml             # Local dev config
└── app-config.production.yaml  # Production config overrides
```

## Common Commands

Run from the repo root:

```bash
yarn start              # Start both frontend and backend in dev mode
yarn build:backend      # Build the backend
yarn build:all          # Build all packages
yarn tsc                # Type-check
yarn tsc:full           # Type-check without skipLibCheck
yarn lint               # Lint changed files since origin/main
yarn lint:all           # Lint all files
yarn test               # Run unit tests
yarn test:all           # Run unit tests with coverage
yarn test:e2e           # Run Playwright end-to-end tests
yarn prettier:check     # Check formatting
yarn fix                # Auto-fix lint and formatting issues
yarn new                # Scaffold a new plugin or package
yarn clean              # Clean build artifacts
```

## Architecture

### Frontend (`packages/app`)

Uses the **new declarative Backstage frontend system** (`@backstage/frontend-defaults`, `@backstage/frontend-plugin-api`). Entry point is [packages/app/src/App.tsx](packages/app/src/App.tsx) using `createApp()`.

Active plugins (configured via `app-config.yaml` `extensions` key and `createApp` features):
- Catalog (set as root `/` page)
- API Docs, Catalog Graph, Catalog Import
- Scaffolder (Software Templates)
- TechDocs (with addons)
- Kubernetes
- Org, User Settings
- Search
- Notifications, Signals
- Auth

### Backend (`packages/backend`)

Uses the **new Backstage backend system** (`@backstage/backend-defaults`, `createBackend()`). Entry point is [packages/backend/src/index.ts](packages/backend/src/index.ts).

Active backend plugins:
- `plugin-app-backend` — serves the frontend
- `plugin-proxy-backend`
- `plugin-scaffolder-backend` + GitHub module + notifications module
- `plugin-techdocs-backend`
- `plugin-auth-backend` + guest provider
- `plugin-catalog-backend` + scaffolder entity model module + logs module
- `plugin-permission-backend` + allow-all policy module
- `plugin-search-backend` + pg engine + catalog/techdocs collators
- `plugin-kubernetes-backend`
- `plugin-notifications-backend` + `plugin-signals-backend`
- `plugin-mcp-actions-backend`

### Database

- **Development:** `better-sqlite3` in-memory (`:memory:`)
- **Production:** PostgreSQL via `pg` driver (see `app-config.production.yaml`)

### Auth

Guest provider enabled by default (no login required in dev). GitHub auth provider is available via `plugin-auth-backend-module-github-provider`. GitHub integration requires `GITHUB_TOKEN` env var.

### MCP Actions

MCP actions backend is enabled, exposing catalog, scaffolder, and auth actions. Configured under `mcpActions` in `app-config.yaml`.

## Configuration

Key environment variables:
- `GITHUB_TOKEN` — GitHub Personal Access Token for catalog/scaffolder GitHub integration

`app-config.yaml` is the local dev config. Do not commit secrets — use env var substitution (`${VAR}`).

## Testing

- Unit tests: Jest with `@testing-library/react` for frontend components
- E2E tests: Playwright (`playwright.config.ts` at root)
- Run individual package tests: `yarn workspace app test` or `yarn workspace backend test`

## Adding Plugins

Use the Backstage CLI scaffold command:

```bash
yarn new
```

New plugins go in `plugins/` and must be wired into `packages/app/src/App.tsx` (frontend) or `packages/backend/src/index.ts` (backend).
