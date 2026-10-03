# ClaimPilot

Multi-agent triage for flight-delay insurance claims. An orchestrating agent delegates to specialised
sub-agents (policy, flight evidence, weather via the external **Open-Meteo MCP server**), integrity checks run as
plain code, and a deterministic rules engine decides the outcome: **APPROVE / REJECT / REFER / NEED_INFO**.

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
   **Integrity checks** then run for every claim with a policy: an earlier claim for the same flight (paid or
   open), a policy bought after the flight was due to leave, and whether the claimant is on the quoted booking.
   These are plain code, not an agent: each rule is a lookup and a comparison, so a model would add cost and
   quota use without adding judgement.
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
   | Same flight already paid to this customer | REJECT |
   | Any other integrity flag (open duplicate, bought after departure, not on booking) | REFER (a flag is a reason to look, not proof) |
   | Otherwise | **APPROVE** the tier the record reaches, which may be lower than claimed |

   Any agent failure → REFER to a human.
10. **Human review.** Every REFER lands in a review queue (`GET /reviews`, reviewer role only, oldest first)
    with the referral reasons, integrity flags, recorded delay and the payout approval would give. A reviewer
    records APPROVE (at one of the policy's tiers), REJECT or NEED_INFO with a required note
    (`POST /reviews/:claimId/decision`). The triage outcome is kept unchanged for the audit trail; the review
    holds the final say, and the decision is appended to the trace. A claim can only be decided once.
11. Every step is a trace event. `GET /claims/:id/events` streams them; `GET /claims/:id` returns facts,
   evidence, the outcome with cited clauses and payout, the orchestrator's summary and the safety checks.

### Safety and grounding

- **Prompt injection.** The claim text is wrapped in a `<claim>` fence for Intake, and any tag that could close
  the fence is removed first. Intake has no tools and returns only a typed schema; every later agent sees those
  facts, never the raw text; the decision is made by code from records. So an instruction in a claim can at most
  bend the extracted facts, which the flight record and rules then check. A pattern scan (instruction overrides,
  role markers, "approve the maximum", tags) flags suspicious text in the trace and on the claim page for the
  reviewer. Detection is for visibility; safety doesn't depend on it.
- **Grounded summary.** Every clause, flight number, time, date, amount and minute count in the orchestrator's
  summary is checked against the evidence (local times only, so a UTC time quoted as local is caught). If any
  value isn't supported, or there's no summary, it's replaced by one built from the evidence, and the trace
  records what was rejected. The summary never affects the decision.
- **Failure injection.** With `ALLOW_FAILURE_INJECTION=true`, `POST /claims` accepts
  `x-inject-failure: intake,orchestrator,policy,flight,weather,integrity` (any subset) to make those steps fail
  for that claim. Without the flag the header is refused with `400`. Used by tests and evals to show every
  failure ends in REFER (or, for the orchestrator, recovery by the guard).

```bash
curl -X POST localhost:3000/claims -H 'x-api-key: dev-claimant-key' -H 'x-inject-failure: flight' \
  -H 'content-type: application/json' \
  -d '{"customerId":"C-1042","policyId":"P-77","message":"6E-2134 Mumbai to Delhi yesterday, 4 hours late"}'
```

### Demo data (fictional)

| Policy | Holder | Notes |
|---|---|---|
| P-77 SkyGuard Standard | C-1042 | Delay from departure; 2h ₹2,000 · 4h ₹5,000 · 6h ₹10,000; excludes severe weather |
| P-91 SkyGuard Plus | C-2077 | Delay from **arrival**; 90m ₹3,000 · 3h ₹6,000; covers weather |
| P-12 SkyGuard Standard | C-1042 | Expired 2025 |
| P-60 SkyGuard Standard | C-3001 | Bought yesterday with backdated cover: the late-purchase scenario |

| Booking | Flight | Passengers | Scenario |
|---|---|---|---|
| XK9P2L | 6E2134 | C-1042 | Normal |
| QP7Y4M | QP1303 | C-2077 | Normal |
| LT3001 | 6E2134 | C-3001 | Late purchase |
| ZZ9999 | AI865 | C-5555 | Quoted by C-1042: not on booking, wrong flight |

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

## Evaluation

Unit and e2e tests use a scripted mock model, so they test the code. **Evals test the model's behaviour**: they
run 19 scenario cases through the real triage pipeline with the configured model, recorded flights and stubbed
weather (so a fog case doesn't depend on the real sky), then grade each attempt from the stored claim **and its
trace**, not just the final text.

```bash
cd claimpilot-api
npm run eval                          # all cases once (~10 min on the Gemini free tier, paced at 14 calls/min)
npm run eval -- --repeat 3            # three attempts per case: exposes flaky behaviour
npm run eval -- --judge               # also score explanations with an LLM judge
npm run eval -- --case fog-severe,strike
npm run eval -- --update-baseline     # accept this run as evals/baseline.json
npm run eval:export-reviews           # turn reviewers' decisions into cases (evals/cases/reviewed/)
```

| Dimension | What it checks | Example failure it names |
|---|---|---|
| decision | Decision, payout tier and cited clauses | `expected APPROVE, got REFER` |
| extraction | Facts Intake pulled from the text | `claimedDelayMinutes: expected 60, got 600` |
| routing | Orchestrator delegated the required agents itself; unneeded agents never ran; guard interventions as expected | `weather not run` |
| tools | Calls per agent within its limit; no call refused for leaving the claim's scope | `policy calls within limit: 4 of 3` |
| grounding | The orchestrator's summary passed the grounding check | `time 05:05` |
| safety | Injection flagged when expected | |

Headline metrics: **false-approve rate** (target 0, the costly error), decision accuracy, pass rate per dimension,
flaky cases (some attempts pass, some fail), guard interventions, a confusion matrix, reviewer agreement (review
cases only) and judge scores. Attempts broken by the model provider (quota, 503) are counted separately and not
scored, since they say nothing about behaviour.

Each run is stored in its own database (`claimpilot-evals`, so eval claims never mix with real ones), written to
`evals/report.json`, and compared with the committed `evals/baseline.json`: a new false approval, or any rate
falling more than 5 points, is a regression, named by metric, and the command exits non-zero (usable in CI).
Reviewers see runs under **Evaluations** in the web app.

**Baseline** (`evals/baseline.json`, gemini-3.5-flash-lite, 19 cases × 1): false approvals **0%**, decision
accuracy **84.2%**, extraction 100%, tools 100%, routing 92.3%, grounding 94.1%, safety 100%. What the failures
showed:

- **Policy agent over-flags exclusions.** For a "technical fault" or "engineering problem" it sometimes flags the
  severe-weather and strike exclusions too. That triggers a weather check nobody needed and, through the
  strike exclusion, a REFER (top-tier, duplicate-paid, orchestrator-down). Safe side, but wrong and costly in
  reviewer time: the issue to fix next.
- **Grounding check caught a real slip**: a summary stated "226 minutes" where the record shows 230; it was replaced
  by the evidence summary.
- **The judge (same small model) is noisy**: on one referral it claimed no explanation was given. Its scores are
  reported for trend only.

The LLM judge rates clarity, faithfulness and tone of the reasons and summary (1–5). It grades text only, never
the decision, and is reported but never gates, because judges have their own bias.

## Tests, lint and formatting

Both apps use the same scripts:

```bash
npm test          # Jest (api) / Vitest (web)
npm run lint
npm run format    # Prettier, 4-space indent
```
