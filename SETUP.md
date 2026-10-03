# ClaimPilot setup

Everything needed to run ClaimPilot locally, from a clean machine. Takes about 15 minutes.

**What you actually need**

| | Required? | Account / key |
|---|---|---|
| Node 24, Docker | Yes | No |
| One language model (Gemini, Groq or Ollama) | Yes | Gemini or Groq key; Ollama needs none |
| Weather: Open-Meteo MCP server | Yes, from the weather phase | No key |
| Airport weather reports (METAR) | No, recorded data is committed | No account |
| Live flight data (AeroDataBox) | No, recorded flights are the default | Free RapidAPI key, only for live mode |

- [1. Tools](#1-tools)
- [2. MongoDB](#2-mongodb)
- [3. Language model and API keys](#3-language-model-and-api-keys)
- [3b. Evidence data: weather, METAR and flight data](#3b-evidence-data-weather-metar-and-flight-data)
- [4. Configure the API](#4-configure-the-api)
- [5. Configure the web app](#5-configure-the-web-app)
- [6. Run and check it works](#6-run-and-check-it-works)
- [7. Tests](#7-tests)
- [8. Troubleshooting](#8-troubleshooting)
- [Appendix: free-tier limits and which provider to use](#appendix-free-tier-limits-and-which-provider-to-use)

---

## 1. Tools

| Tool | Version | Why |
|---|---|---|
| Node.js | **24** (via nvm) | NestJS 12 ships as ES modules; Jest can only load them on Node ≥ 24.9 |
| npm | comes with Node | Package manager |
| Docker Desktop | any recent | Runs MongoDB locally |

```bash
# nvm: https://github.com/nvm-sh/nvm
nvm install 24
nvm use 24        # each app has an .nvmrc, so plain `nvm use` works inside them
node -v           # v24.x
```

Docker Desktop: install from <https://www.docker.com/products/docker-desktop/> and start it (the whale icon
must say "running").

## 2. MongoDB

From the repo root:

```bash
docker compose up -d mongo
docker compose ps          # claimpilot-mongo should be "healthy"
```

This gives you `mongodb://localhost:27017/claimpilot`, which is already the default in `.env.example`.

**No Docker?** Create a free MongoDB Atlas M0 cluster (<https://www.mongodb.com/atlas>), allow your IP, and
put its `mongodb+srv://...` connection string in `MONGO_URI`.

## 3. Language model and API keys

The agents need an LLM. Pick **one** provider and set `MODEL=provider:model-id`. None of them need a credit
card. The [appendix](#appendix-free-tier-limits-and-which-provider-to-use) explains the trade-offs; short
version: **use Gemini for the demo, keep Ollama as the unlimited backup.**

### Option A: Google Gemini (recommended, default)

1. Go to <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key**. If asked, create or choose a Google Cloud project (no billing needed).
3. Copy the key (starts with `AIza`).
4. Check your actual free limits at <https://aistudio.google.com/rate-limit> (Google no longer publishes fixed
   free-tier numbers; they vary per project).

```env
MODEL=google:gemini-3.5-flash-lite
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

**Which Gemini model** (tested with a new free key, Oct 2026):

| Model id | Result |
|---|---|
| `gemini-2.5-flash` | ❌ "no longer available to new users", even though it still appears in the model list |
| `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-flash-latest` | ⚠️ Work, but returned `503 high demand` at peak times |
| `gemini-3.5-flash-lite` (default), `gemini-3.1-flash-lite`, `gemini-flash-lite-latest` | ✅ Answered every time; extraction correct on all test claims, ~1 s per claim |

Start with Flash-Lite. Try `gemini-3.8-flash` for better reasoning in the later, multi-step phases, and switch
back if you see `503`. To see every model your key can use:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
    -H "x-goog-api-key: $GOOGLE_GENERATIVE_AI_API_KEY" | grep '"name"'
```

### Option B: Groq

1. Go to <https://console.groq.com/keys> and sign up.
2. Click **Create API Key** and copy it (starts with `gsk_`).
3. Use a model that is on the free tier **and** supports strict JSON schema output:

```env
MODEL=groq:openai/gpt-oss-120b
GROQ_API_KEY=gsk_...
```

> Llama 3.3 70B is no longer on Groq's free tier, so older guides that use `llama-3.3-70b-versatile` will fail.
> Current free models and limits: <https://console.groq.com/docs/rate-limits>.

### Option C: Ollama (local, unlimited, slower)

1. Install from <https://ollama.com/download> (macOS: `brew install ollama`), then start it: `ollama serve`.
2. Pull a model with good tool-calling and JSON output:

   ```bash
   ollama pull qwen2.5:7b      # ~4.7 GB; needs ~8 GB free RAM
   ```

3. Configure:

```env
MODEL=ollama:qwen2.5:7b
OLLAMA_BASE_URL=http://localhost:11434/api   # default; only set if Ollama runs elsewhere
```

No key needed. Quality is lower than Gemini, but there are no rate limits, so it's the safe choice for
running the eval suite many times.

### Keeping keys safe

- Keys go in `claimpilot-api/.env`, which is git-ignored. Never commit it and never paste keys into the web
  app's `.env` (anything in `VITE_*` is shipped to the browser).
- Free-tier Gemini prompts may be used by Google to improve its products. ClaimPilot only uses made-up claim
  data, so this is fine for the exercise; don't send real customer data on a free tier.

## 3b. Evidence data: weather, METAR and flight data

The evidence agents arrive in later phases (policy → flight history → weather → integrity). Nothing in this
section is needed yet; it's here so you can prepare. Every source except the weather MCP server runs on
**recorded data (fixtures) by default**, so evals are repeatable and use no quota. Live calls are opt-in.


### Weather: Open-Meteo MCP server (the required external MCP)

The Weather agent gets historical weather through an external MCP server,
[`open-meteo-mcp-server`](https://github.com/cmer81/open-meteo-mcp) (npm, v2.5). The API starts it as a child
process over stdio; you don't run it yourself. The Weather agent is given only its `weather_archive` tool
(hourly historical weather); the server's other 16 tools (forecasts, marine, flood, etc.) are not exposed to
any agent.

- **Key:** none.
- **Needs:** internet access to `api.open-meteo.com` / `archive-api.open-meteo.com`, and `npx` (comes with
  npm). The first start downloads the package.
- **Free limits:** non-commercial use, under 10,000 calls/day, 5,000/hour and 600/minute; data is CC BY 4.0, so
  credit Open-Meteo in the README. A claim makes 1–3 weather calls, so limits aren't a concern.
- **Check it works** before that phase:

  ```bash
  npx -y open-meteo-mcp-server    # should start and wait for input; Ctrl+C to stop
  ```

- Variables: `OPEN_METEO_MCP_COMMAND` (default `npx -y open-meteo-mcp-server`; change it to pin a version or use a
  global install) and `WEATHER_TIMEOUT_MS` (default 20000; covers the first call starting the server).
- The server only starts the first time a claim actually needs a weather check, and stops with the API.

If the server can't start or times out, the Weather agent reports the source as unavailable and the claim is
referred to a human. That failure is one of the eval scenarios.

### Airport weather reports: METAR from Iowa Environmental Mesonet

Open-Meteo's historical data is a ~25 km grid: good for heavy rain and wind, weak for fog at an airport.
Airport observations (METAR: visibility, fog codes) fill that gap.

- **Key / account:** none.
- **How it's used:** a few days of reports for the demo airports (e.g. `VIDP` Delhi, `VABB` Mumbai) are
  downloaded once and committed under `claimpilot-api/fixtures/metar/`. The app reads those files, so nothing
  is needed at runtime.
- **Refreshing them** (optional), one station and date range per request:

  ```text
  https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=VIDP&data=vsby&data=wxcodes&data=sknt
      &year1=2025&month1=12&day1=20&year2=2025&month2=12&day2=21&tz=Etc/UTC&format=onlycomma
  ```

  The service is free and sometimes answers `server over capacity`; retry later.

### Flight data: AeroDataBox (optional, live mode only)

Flight status (scheduled vs actual times) comes from **recorded flights** by default, covering every eval
scenario and working for any date (see the table in the README). Live lookups are only for trying real flights.

1. Create a free RapidAPI account and open AeroDataBox:
   <https://rapidapi.com/aedbx-aedbx/api/aerodatabox>.
2. Subscribe to the free **Basic** plan (a few hundred API units a month at the time of writing; check the
   pricing tab, as quota and history depth change).
3. Copy your key from the endpoint page (`X-RapidAPI-Key` header).
4. Set in `claimpilot-api/.env`:

   ```env
   FLIGHT_DATA_MODE=live              # default: fixtures
   AERODATABOX_API_KEY=...            # RapidAPI key; required in live mode
   # AERODATABOX_HOST=aerodatabox.p.rapidapi.com   (default)
   ```

> The AeroDataBox response mapping (`src/flights/aerodatabox.mapper.ts`) is built from AeroDataBox's documented
> fields and tested against a hand-written sample, not yet against a real response. Try one known flight
> after adding a key and compare the times with the airline's site before relying on live mode.

Keep live mode off for evals: a few hundred units a month runs out quickly, and live data makes results
change from run to run.

### Policy documents and customer data

Nothing to set up. The policies, customers, bookings and claim history are fictional and live in the repo;
they're loaded into MongoDB by a seed script in the phases that use them.

## 4. Configure the API

```bash
cd claimpilot-api
nvm use
cp .env.example .env
npm install
```

Edit `.env`:

| Variable | Default | What to set |
|---|---|---|
| `PORT` | `3000` | Change only if 3000 is taken (then update `VITE_API_URL` too) |
| `MONGO_URI` | `mongodb://localhost:27017/claimpilot` | Keep for Docker; Atlas URI otherwise |
| `API_KEYS` | `claimant:dev-claimant-key,reviewer:dev-reviewer-key` | Keys the API accepts, as `role:key` pairs. Fine as-is locally |
| `MODEL` | `google:gemini-3.5-flash-lite` | From step 3 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | empty | Required when `MODEL` starts with `google:` |
| `GROQ_API_KEY` | not set | Required when `MODEL` starts with `groq:` |
| `OLLAMA_BASE_URL` | `http://localhost:11434/api` | Only for Ollama on another host |
| `MODEL_REQUESTS_PER_MINUTE` | `14` | Paces all agents' model calls under the free-tier quota (Gemini Flash-Lite: 15/min). `0` = no limit |
| `OPEN_METEO_MCP_COMMAND` / `WEATHER_TIMEOUT_MS` | `npx -y open-meteo-mcp-server` / `20000` | Weather MCP server (see 3b) |
| `HTTP_TIMEOUT_MS` / `HTTP_MAX_RETRIES` | `8000` / `2` | Outbound calls (AeroDataBox; weather later) |
| `CLAIMANT_TIMEZONE` | `Asia/Kolkata` | Zone for "today" and claim dates (01:30 IST on 2 Oct is still 1 Oct in UTC) |
| `FLIGHT_DATA_MODE` | `fixtures` | `live` for AeroDataBox (needs `AERODATABOX_API_KEY`) |
| `CORS_ORIGINS` | `http://localhost:5173` | Where the web app runs |

The API checks all of this at startup and lists every problem at once, for example:

```text
Invalid environment configuration:
  GOOGLE_GENERATIVE_AI_API_KEY: required when MODEL uses google
```

## 5. Configure the web app

```bash
cd claimpilot-web
nvm use
cp .env.example .env
npm install
```

| Variable | Default | Must match |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | The API's `PORT` |
| `VITE_CLAIMANT_API_KEY` | `dev-claimant-key` | The `claimant:` key in the API's `API_KEYS` |
| `VITE_REVIEWER_API_KEY` | `dev-reviewer-key` | The `reviewer:` key in the API's `API_KEYS` |

These are demo keys that identify a role, not secrets. The LLM key never goes here.

## 6. Run and check it works

Two terminals:

```bash
# terminal 1
cd claimpilot-api && npm run start:dev

# terminal 2
cd claimpilot-web && npm run dev
```

Check, in order:

1. `curl http://localhost:3000/health` → `{"status":"ok","mongo":"up",...}`
2. <http://localhost:3000/docs> shows Swagger.
3. <http://localhost:5173> shows the app, with **API · online** at the bottom of the sidebar.
4. Click **Delay payout**, then **Run triage**. Within ~10 seconds the trace shows the orchestrator delegating
   to the Policy and Flight agents and the outcome is **Approved, INR 2,000** (3h50m recorded vs 4h claimed).
5. Try **Fog (exclusion)**: the orchestrator also calls the Weather agent, which queries the Open-Meteo MCP
   server; unless there really was severe weather that day, it's **Approved** with "exclusion §7.3 doesn't apply".
6. Other examples: **Short delay** → Rejected, **Arrival-measured** → Approved INR 6,000, **Late purchase** →
   Referred (§7.1), **Wrong booking** → Referred, **Unknown flight** → Need info, **Missing details** → Need info.
7. Submit **Delay payout** a second time: the duplicate is **Rejected** because the first one was already paid.

If step 4 ends in **Referred**, the model call failed; the API terminal shows why (usually a bad key or a rate
limit, see below).

## 7. Tests

No API key, Docker or running server needed: tests use an in-memory MongoDB and a mock language model.

```bash
cd claimpilot-api && npm test     # first run downloads a MongoDB binary (~100 MB)
cd claimpilot-web && npm test
npm run lint                      # in either app
```

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment configuration: ...` at startup | Missing or malformed `.env` value | Fix the listed variables |
| `/health` returns 503 `MongoDB not connected` | Mongo not running or wrong URI | `docker compose up -d mongo`; check `MONGO_URI` |
| Claims always end in **Referred** | Model call failing | Check the API log: `401/403` = bad key, `429` = rate limit, `404` = wrong model id |
| Claims slow down after a few runs | `MODEL_REQUESTS_PER_MINUTE` pacing (~8–11 model calls per claim) | Expected on the free tier: calls queue instead of failing |
| Claims end in **Referred** with a quota error in the log | Limit set higher than your project's real quota | Lower `MODEL_REQUESTS_PER_MINUTE` to your AI Studio limit minus one |
| `429` / "quota exceeded" | Free-tier limit hit | Wait a minute (per-minute limit) or until reset (daily limit); switch `MODEL` to another provider or to Ollama |
| Web shows **API · offline** | API not running, wrong `VITE_API_URL`, or CORS | Start the API; check `VITE_API_URL` and `CORS_ORIGINS` |
| Submitting returns `Requires role: claimant` | Role switch is on Reviewer | Switch to **Claimant** in the top bar |
| `Must use import to load ES Module` in tests | Wrong Node version | `nvm use` (Node 24) |
| `ECONNREFUSED 127.0.0.1:11434` | Ollama not running | `ollama serve` |
| Weather agent always "unavailable" | MCP server can't start (no internet, `npx` blocked) | Run `npx -y open-meteo-mcp-server` by hand to see the error |
| `server over capacity` when refreshing METAR | Iowa Mesonet busy | Retry later; committed fixtures keep working |
| AeroDataBox `403` / `429` in live mode | Not subscribed, wrong key, or monthly quota used | Check the RapidAPI subscription; switch back to `FLIGHT_DATA_MODE=fixtures` |

---

## Appendix: free-tier limits and which provider to use

*Checked October 2026. Free tiers change often; confirm on the provider pages linked below.*

### What ClaimPilot will ask of the model

| | Today (Intake only) | When all agents are built |
|---|---|---|
| LLM requests per claim | 1 | ~10–15 (orchestrator steps + policy, flight, weather, integrity agents) |
| Tokens per claim | ~1–2K | ~30–60K (instructions, tool schemas and results are re-sent on every step) |
| Eval suite (14 cases × 3 runs) | ~42 requests | ~420–630 requests, ~1.5–2.5M tokens |

### Free tiers compared

| | Gemini (Google AI Studio) | Groq | Ollama |
|---|---|---|---|
| Cost | Free, no card | Free, no card | Free, runs locally |
| Published free limits | Not published; per project in AI Studio. Third-party reports: ~10 RPM for Flash; daily quota cut sharply for many accounts in Dec 2025 | `gpt-oss-120b`: 30 RPM, 1K requests/day, **8K tokens/min, 200K tokens/day** | None |
| Structured JSON output | Yes | Strict JSON schema on `gpt-oss-120b/20b`, `qwen3.8-27b` | Model-dependent; good on Qwen 2.5/3 |
| Structured output + tools in one call | Yes | **No**: Groq doesn't support both at once | Model-dependent |
| Quality for multi-step agents | High | Good | Fair (7B model) |
| Speed | Fast | Very fast | Slow on a laptop |

### Can Groq's free tier serve this use case?

**For the demo of single claims: barely. For the eval suite: no.**

- **Tokens per minute is the bottleneck, not requests.** At 8K tokens/minute, one fully built claim
  (~30–60K tokens) takes 4–8 minutes of token budget. Parallel agent calls (policy and flight run together)
  would hit `429` mid-triage, and ClaimPilot then refers the claim to a human. That is correct behaviour, but
  it would make the system look broken in a demo.
- **200K tokens/day ≈ 4–6 complete claims per day.** The eval suite needs ~1.5–2.5M tokens, so it cannot
  finish in a day on Groq's free tier.
- **Structured output can't be combined with tool calls** in one Groq request. Intake (no tools) is fine; the
  tool-using agents need the structured answer as a separate final step.
- **Model churn:** Llama 3.3 70B was removed from the free tier in 2026, so the model id needs to be kept up
  to date.

### Can Gemini's free tier serve it?

**Usually yes for the demo; the eval suite depends on your project's daily quota.** Per-minute token limits
are far higher than Groq's, so a single claim runs smoothly. The risk is the daily request quota: if AI Studio
shows something like 1,000+ requests/day you can run the full suite; if it shows only a few hundred, run the
suite on Ollama or record model responses (below).

### Recommendation

1. **Demo and day-to-day use: Gemini Flash-Lite** (`google:gemini-3.5-flash-lite`). Reliably available and
   fast; move to `gemini-3.8-flash` for the multi-step phases if it isn't returning `503`. Check your daily
   quota in AI Studio before the panel.
2. **Eval runs: Ollama** (`ollama:qwen2.5:7b`) when you need many runs, or Gemini if your daily quota allows.
3. **Groq: optional fallback only**, not the primary provider.

Planned in later phases so free-tier limits can't fail a run:

- **Recorded model responses for evals.** The suite replays saved responses by default (deterministic, free,
  fast) and only calls a live model when asked. A small live run still proves the real model behaves.
- **Model fallback.** On `503` overload, fall back to a second model (e.g. Flash → Flash-Lite, or Gemini → Groq)
  before referring a claim to a human. (Request pacing under the quota is already in place:
  `MODEL_REQUESTS_PER_MINUTE`.)

### Sources

- Groq free-tier limits (official): <https://console.groq.com/docs/rate-limits>
- Groq structured outputs (official): <https://console.groq.com/docs/structured-outputs>
- Gemini rate limits (official, limits shown per project): <https://ai.google.dev/gemini-api/docs/rate-limits>
- Gemini free-tier changes, Dec 2025: <https://www.howtogeek.com/gemini-slashed-free-api-limits-what-to-use-instead/>
- Gemini free-tier figures reported Sept 2026: <https://www.memetik.ai/guides/gemini-api-free-tier-limits>
- Groq free-tier changes in 2026: <https://klymentiev.com/blog/groq-pricing>
- Open-Meteo terms and free limits: <https://open-meteo.com/en/terms>
- Open-Meteo MCP server: <https://github.com/cmer81/open-meteo-mcp>
- Iowa Environmental Mesonet METAR download: <https://mesonet.agron.iastate.edu/request/download.phtml>
- AeroDataBox on RapidAPI: <https://rapidapi.com/aedbx-aedbx/api/aerodatabox>
