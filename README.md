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

```
POST /claims ─► Intake agent ─► completeness check ─► Orchestrator agent ─► Policy agent ─► guard ─► rules engine
                (raw text, no    (missing → NEED_INFO,  (LLM; delegates via  (clause search,  (runs required   (decides; cites
                 tools)           no other agent runs)   tools, no data)      ≤3 searches)     checks it skipped) clauses)
```

1. `POST /claims` (claimant role) stores the claim and returns `202` straight away.
2. The **Intake agent** turns the free-text message into typed facts. It is the only agent that sees the raw
   text and it has no tools, so instructions hidden in a claim can't trigger anything.
3. Missing flight number, date or delay → **NEED_INFO** with questions, without calling any other agent.
4. The **Orchestrator agent** (LLM) decides whom to consult. Its only tools are delegations to sub-agents, so
   everything it knows comes through them, and every delegation is traced.
5. The **Policy agent** reads the policy wording through a clause-search tool bound to that one policy (at most
   3 searches, enforced in code). It reports how delay is measured and which exclusions the claimed cause
   might trigger. Code then drops any clause it cites that doesn't exist and keeps the schedule's values for
   anything numeric.
6. A **guard** runs the Policy agent itself if the orchestrator skipped it or failed, so a model mistake can't
   skip a required check. Evals will count how often the guard had to step in.
7. The **rules engine** (`adjudicate`, plain code) decides from evidence: unknown policy → NEED_INFO, policy
   held by someone else → REFER, flight outside cover or claim past the deadline → REJECT with the clause,
   otherwise PENDING until flight evidence lands. A failed agent → REFER to a human.
8. Every step is a trace event. `GET /claims/:id/events` streams them (server-sent events); `GET /claims/:id`
   returns facts, policy findings, the outcome with cited clauses, and the orchestrator's summary.

Demo policies (fictional, seeded on startup): **P-77** SkyGuard Standard (C-1042, excludes severe weather),
**P-91** SkyGuard Plus (C-2077, covers weather, measures arrival delay), **P-12** expired 2025 policy (C-1042).

## Tests, lint and formatting

Both apps use the same scripts:

```bash
npm test          # Jest (api) / Vitest (web)
npm run lint
npm run format    # Prettier, 4-space indent
```
