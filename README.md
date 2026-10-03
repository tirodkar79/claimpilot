# ClaimPilot

Multi-agent triage for flight-delay insurance claims. An orchestrating agent delegates to specialised
sub-agents (policy, flight evidence, weather via the external **Open-Meteo MCP server**, integrity next), and a
deterministic rules engine decides the outcome: **APPROVE / REJECT / REFER / NEED_INFO**.

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
POST /claims ─► Intake ─► completeness ─► Orchestrator ─┬─► Policy agent ──┬─► guard ─► rules engine
                (raw text,  (missing →      (LLM; only     ├─► Flight agent ──┤   (runs      (decides from
                 no tools)   NEED_INFO)      delegation     └─► Weather agent ─┘   skipped,   evidence; cites
                                             tools)             (only if a weather   blocks     clauses)
                                                                exclusion matters;   unneeded)
                                                                Open-Meteo MCP)
```

1. `POST /claims` (claimant role) stores the claim and returns `202` straight away.
2. The **Intake agent** turns the free-text message into typed facts. It is the only agent that sees the raw
   text and it has no tools, so instructions hidden in a claim can't trigger anything.
3. Missing flight number, date or delay → **NEED_INFO** with questions, without calling any other agent.
4. The **Orchestrator agent** (LLM) decides whom to consult; it usually calls both sub-agents in parallel. Its
   only tools are delegations, so everything it knows comes through them, and every delegation is traced.
5. The **Policy agent** reads the wording through a clause search bound to that one policy (≤ 3 searches,
   enforced in code). It reports how delay is measured and which exclusions the claimed cause might
   trigger. Code drops citations to clauses that don't exist.
6. The **Flight agent** looks the flight up through a tool bound to the claimed flight number and to dates
   within a day of the claimed date (≤ 2 lookups). It picks the leg matching the claimed route; code accepts
   the pick only if that leg was really returned, and computes the delay itself.
7. The **Weather agent** runs only when the Policy agent flagged a severe-weather exclusion *and* the recorded
   delay reaches a payout tier (otherwise weather can't change the outcome). It calls the external
   **Open-Meteo MCP server** (`weather_archive`, started over stdio) for both airports. Its tool only accepts the
   flight's two airports; code computes "severe or not" from the hourly WMO weather codes and gusts, and
   fetches any window the agent skipped.
8. A **guard** runs any required agent the orchestrator skipped or that failed, and blocks a weather check
   that can't matter, so a model mistake can't skip a check or waste quota. Evals will count its interventions.
9. The **rules engine** (`adjudicate`, plain code) decides, first failing check wins:

   | Check | Outcome |
   |---|---|
   | Policy doesn't exist | NEED_INFO |
   | Policy held by someone else | REFER |
   | Flight outside cover, or claim past the deadline | REJECT (cites clause) |
   | No flight record | NEED_INFO (confirm number and date) |
   | Cancelled, or no actual time yet | REFER |
   | Delay (measured the policy's way) below every tier | REJECT (cites measure and tiers) |
   | Weather exclusion flagged + weather records show severe weather | REJECT (cites clause and observation) |
   | Weather exclusion flagged + no weather records | REFER |
   | Strike exclusion flagged (no evidence source yet) | REFER |
   | Otherwise | **APPROVE** the tier the record reaches, which may be lower than claimed |

   Any agent failure → REFER to a human.
10. Every step is a trace event. `GET /claims/:id/events` streams them; `GET /claims/:id` returns facts,
   evidence, the outcome with cited clauses and payout, and the orchestrator's summary.

### Demo data (fictional)

| Policy | Holder | Notes |
|---|---|---|
| P-77 SkyGuard Standard | C-1042 | Delay from departure; 2h ₹2,000 · 4h ₹5,000 · 6h ₹10,000; excludes severe weather |
| P-91 SkyGuard Plus | C-2077 | Delay from **arrival**; 90m ₹3,000 · 3h ₹6,000; covers weather |
| P-12 SkyGuard Standard | C-1042 | Expired 2025 |

| Recorded flight | Route | What it shows |
|---|---|---|
| 6E2134 | BOM → DEL | 3h50m late: pays the 2h tier even if 4h is claimed |
| AI865 | BOM → DEL | 1h20m late: below every tier |
| UK951 | DEL → BOM | 6h40m late: top tier |
| QP1303 | BOM → GOI | 1h40m late leaving, 3h10m late arriving: depends on the policy's measure |
| 6E6187 | HYD → DEL → SXR | Two legs: the claimed route picks the leg |
| SG160 | BOM → DEL | Cancelled |
| 6E2314 | — | No record (typo of 6E2134) |

Weather is always live from Open-Meteo (real historical data), so a "fog" claim on a clear day is approved
with the weather evidence as the reason. Recorded flights apply to any date, so demos and evals keep working. Set `FLIGHT_DATA_MODE=live` for real
AeroDataBox lookups (see [SETUP.md](SETUP.md)). The **New claim** screen has one example per scenario.

## Tests, lint and formatting

Both apps use the same scripts:

```bash
npm test          # Jest (api) / Vitest (web)
npm run lint
npm run format    # Prettier, 4-space indent
```
