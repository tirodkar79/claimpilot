# ClaimPilot

Multi-agent triage for flight-delay insurance claims. An orchestrating agent delegates to specialised
sub-agents (policy, flight evidence, weather via an external MCP server, integrity), and a deterministic rules
engine decides the outcome: **APPROVE / REJECT / REFER / NEED_INFO**.

> Work in progress. This README grows phase by phase.

## Repository layout

| Folder | What |
|---|---|
| `claimpilot-api/` | NestJS API: agents, tools, rules engine, MongoDB, evals |
| `claimpilot-web/` | React + Vite UI |
| `docker-compose.yml` | MongoDB for local development |

Each app has its own `package.json` and runs independently.

## Prerequisites

Full step-by-step setup, including API keys: **[SETUP.md](SETUP.md)**.

- Node 24 (`nvm use` picks it up from `.nvmrc`). NestJS 12 is ESM-only and Jest needs Node ≥ 24.9 to load it.
- Docker (for MongoDB)

## Quick start

```bash
docker compose up -d mongo

cd claimpilot-api
nvm use
cp .env.example .env
npm install
npm run start:dev        # http://localhost:3000/health · Swagger at /docs · spec at /docs-json
```

Every route needs an `x-api-key` header (keys and roles come from `API_KEYS` in `.env`) unless it's marked
public. Errors are returned as `{ error: { code, message, requestId } }`, and every response carries an
`x-request-id` header.

Then the web app, in a second terminal:

```bash
cd claimpilot-web
nvm use
cp .env.example .env     # keys must match API_KEYS in claimpilot-api/.env
npm install
npm run dev              # http://localhost:5173
```

The role switch in the top bar picks which API key the UI sends. These keys live in `VITE_*` variables, so
they ship to the browser: fine for a local demo, not for production.

## Language model

Agents run on Gemini (default), Groq or a local Ollama model, chosen with `MODEL=provider:model-id` in
`claimpilot-api/.env`. The API refuses to start if the selected provider's key is missing. Tests never call a
real model; they use the AI SDK's mock model.

See **[SETUP.md](SETUP.md)** for getting API keys, free-tier limits and which provider to use.

## How a claim flows (so far)

1. `POST /claims` (claimant role) stores the claim and returns `202` straight away.
2. The **Intake agent** turns the free-text message into typed facts. It is the only agent that sees the raw
   text and it has no tools, so instructions hidden in a claim can't trigger anything.
3. The orchestrator checks the facts: missing flight number, date or delay → **NEED_INFO** with questions;
   complete → **PENDING** until the evidence agents land; any agent failure → **REFER** to a human.
4. Every step is stored as a trace event. `GET /claims/:id/events` streams them (server-sent events) and the
   web app shows them live. `GET /claims/:id` returns the facts and outcome.

## Tests, lint and formatting

Both apps use the same scripts:

```bash
npm test          # Jest (api) / Vitest (web)
npm run lint
npm run format    # Prettier, 4-space indent
```
