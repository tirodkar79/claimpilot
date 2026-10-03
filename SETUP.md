# ClaimPilot setup

Everything needed to run ClaimPilot locally, from a clean machine. Takes about 15 minutes.

**What you actually need**

| | Required? | Account / key |
|---|---|---|
| Node 24, Docker | Yes | No |
| One language model (Gemini, Groq or Ollama) | Yes | Gemini or Groq key; Ollama needs none |
| Weather: Open-Meteo MCP server | Yes (started automatically with `npx`) | No key |
| Live flight data (AeroDataBox) | No, recorded flights are the default | Free RapidAPI key, only for live mode |

**Quick start** (Node 24 and Docker installed, a Gemini key from step 3 in hand):

```bash
cd claimpilot                                                # the folder with docker-compose.yml
docker compose up -d mongo                                   # MongoDB on localhost:27017

cd claimpilot-api && nvm use && npm install && cp .env.example .env
# edit .env: GOOGLE_GENERATIVE_AI_API_KEY=AIza...
npm run start:dev                                            # API on http://localhost:3000

cd ../claimpilot-web && nvm use && npm install && cp .env.example .env
npm run dev                                                  # app on http://localhost:5173
```

**Keys and accounts at a glance**

| What | Where to get it | Goes in | Needed for |
|---|---|---|---|
| Gemini API key | <https://aistudio.google.com/apikey> ([steps](#option-a-google-gemini-recommended-default)) | `claimpilot-api/.env` → `GOOGLE_GENERATIVE_AI_API_KEY` | Agents, if `MODEL=google:...` (default) |
| Groq API key | <https://console.groq.com/keys> ([steps](#option-b-groq)) | `GROQ_API_KEY` | Only if `MODEL=groq:...` |
| Ollama | Local install, no key ([steps](#option-c-ollama-local-unlimited-slower)) | `OLLAMA_BASE_URL` (optional) | Only if `MODEL=ollama:...` |
| RapidAPI key for AeroDataBox | <https://rapidapi.com/aedbx-aedbx/api/aerodatabox> ([steps](#flight-data-aerodatabox-optional-live-mode-only)) | `AERODATABOX_API_KEY` | Only if `FLIGHT_DATA_MODE=live` |
| MongoDB Atlas user + connection string | <https://www.mongodb.com/atlas> ([steps](#option-c-mongodb-atlas-free-cloud-no-local-install)) | `MONGO_URI` | Only if you don't run MongoDB locally |
| ClaimPilot's own API keys | You choose them ([steps](#4-configure-the-api)) | API `API_KEYS` and web `VITE_*_API_KEY` | Always; the defaults work locally |
| Open-Meteo (weather MCP) | Nothing to get | — | Works without a key |

- [1. Tools](#1-tools)
- [2. MongoDB](#2-mongodb)
- [3. Language model and API keys](#3-language-model-and-api-keys)
- [3b. Evidence data: weather and flight data](#3b-evidence-data-weather-and-flight-data)
- [4. Configure the API](#4-configure-the-api)
- [5. Configure the web app](#5-configure-the-web-app)
- [6. Run and check it works](#6-run-and-check-it-works)
- [7. Tests](#7-tests)
- [7b. Evals](#7b-evals-needs-a-model-key-and-mongodb)
- [8. Troubleshooting](#8-troubleshooting)
- [Demo data](#demo-data-fictional)
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

The API needs MongoDB 7 or later. It creates everything itself on first start: the `claimpilot` database
(claims, traces, and the seeded policies and bookings) and, when you run evals, a separate `claimpilot-evals`
database. Pick one option.

### Option A: Docker (recommended)

Docker Desktop must be running. Run this in the `claimpilot/` folder (where `docker-compose.yml` is), or add
`-f ../docker-compose.yml` when running it from inside `claimpilot-api/` or `claimpilot-web/`:

```bash
docker compose up -d mongo
docker compose ps          # claimpilot-mongo should be "healthy"
```

`MONGO_URI=mongodb://localhost:27017/claimpilot` is already the default in `.env.example`. Data survives
restarts in the `mongo-data` volume. Stop with `docker compose stop mongo`; wipe everything with
`docker compose down -v`.

### Option B: Installed locally (no Docker)

macOS with Homebrew:

```bash
brew tap mongodb/brew
brew install mongodb-community@8.0
brew services start mongodb-community@8.0     # stop: brew services stop mongodb-community@8.0
```

Windows and Linux: install MongoDB Community Server from
<https://www.mongodb.com/try/download/community> and start the service. The default `MONGO_URI` works as-is.

### Option C: MongoDB Atlas (free cloud, no local install)

1. Sign up at <https://www.mongodb.com/atlas> and create a free **M0** cluster (any region near you).
2. **Database Access** → **Add New Database User**: choose a username and password (avoid `@ : / ?` in the
   password, or URL-encode them).
3. **Network Access** → **Add IP Address** → **Add Current IP Address** (or `0.0.0.0/0` for a throwaway demo).
4. **Database** → **Connect** → **Drivers** and copy the `mongodb+srv://...` string.
5. Put your password in it and add the database name `claimpilot` before the `?`:

   ```env
   MONGO_URI=mongodb+srv://claimpilot:<password>@cluster0.abcde.mongodb.net/claimpilot?retryWrites=true&w=majority
   ```

### Check it

```bash
mongosh "mongodb://localhost:27017/claimpilot" --eval "db.runCommand({ ping: 1 })"   # { ok: 1 }
# with Docker and no local mongosh:
docker exec claimpilot-mongo mongosh --quiet --eval "db.runCommand({ ping: 1 })"
```

Once the API runs, `curl http://localhost:3000/health` reports `"mongo":"up"`.

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

Start with Flash-Lite. Try `gemini-3.8-flash` for better reasoning, and switch back if you
see `503`.

**Fallback model (recommended).** Free quotas are counted **per model** (for example 500 requests/day for
Flash-Lite). Set a second model and the API switches to it whenever the first returns a quota error (`429`),
is overloaded (`5xx`) or doesn't answer; config mistakes (`400`, `404`) still fail loudly:

```env
MODEL=google:gemini-3.5-flash-lite
MODEL_FALLBACK=google:gemini-3.1-flash-lite    # or groq:openai/gpt-oss-120b, or ollama:qwen2.5:7b
```

Each model is paced separately. The API log says when it switched (at most once a minute). The fallback may
reason less well: in a quick check, 3.1-flash-lite's Policy agent overran its search limit and the claim was
referred. Run evals on the fallback to know what you're getting. To see every model your key can use:

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

## 3b. Evidence data: weather and flight data

Nothing in this section needs a key. Flight data is **recorded by default** (live AeroDataBox is opt-in); weather
comes live from the Open-Meteo MCP server (evals stub it so their fog cases are repeatable).


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
- **Check it works:**

  ```bash
  npx -y open-meteo-mcp-server    # should start and wait for input; Ctrl+C to stop
  ```

- Variables: `OPEN_METEO_MCP_COMMAND` (default `npx -y open-meteo-mcp-server`; change it to pin a version or use a
  global install) and `WEATHER_TIMEOUT_MS` (default 20000; covers the first call starting the server).
- The server only starts the first time a claim actually needs a weather check, and stops with the API.

If the server can't start or times out, the Weather agent reports the source as unavailable and the claim is
referred to a human. That failure is one of the eval scenarios.

### Flight data: AeroDataBox (optional, live mode only)

Flight status (scheduled vs actual times) comes from **recorded flights** by default, covering every eval
scenario and working for any date (see the table in the README). Live lookups are only for trying real flights.

1. Create a free RapidAPI account and open AeroDataBox:
   <https://rapidapi.com/aedbx-aedbx/api/aerodatabox>.
2. Subscribe to the free **Basic** plan (a few hundred API units a month at the time of writing; check the
   pricing tab, as quota and history depth change).
3. Copy your key from the endpoint page (`X-RapidAPI-Key` header), or from **Apps** → **default-application** →
   **Authorization**.
4. Test it with one known flight (replace the date with a recent one):

   ```bash
   curl -s "https://aerodatabox.p.rapidapi.com/flights/number/6E2134/2026-09-30" \
       -H "X-RapidAPI-Key: $AERODATABOX_API_KEY" -H "X-RapidAPI-Host: aerodatabox.p.rapidapi.com"
   ```

   A JSON list of legs means it works; `403` means you're not subscribed to the plan yet.
5. Set in `claimpilot-api/.env`:

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
they're seeded into MongoDB when the API starts.

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
| `MODEL_FALLBACK` | not set | Optional second model for quota/overload errors, e.g. `google:gemini-3.1-flash-lite` (its provider's key is required too) |
| `MODEL_REQUESTS_PER_MINUTE` | `14` | Paces all agents' model calls under the free-tier quota (Gemini Flash-Lite: 15/min). `0` = no limit |
| `OPEN_METEO_MCP_COMMAND` / `WEATHER_TIMEOUT_MS` | `npx -y open-meteo-mcp-server` / `20000` | Weather MCP server (see 3b) |
| `HTTP_TIMEOUT_MS` / `HTTP_MAX_RETRIES` | `8000` / `2` | Outbound calls (AeroDataBox; weather later) |
| `CLAIMANT_TIMEZONE` | `Asia/Kolkata` | Zone for "today" and claim dates (01:30 IST on 2 Oct is still 1 Oct in UTC) |
| `FLIGHT_DATA_MODE` | `fixtures` | `live` for AeroDataBox (needs `AERODATABOX_API_KEY`) |
| `CORS_ORIGINS` | `http://localhost:5173` | Where the web app runs |
| `ALLOW_FAILURE_INJECTION` | `false` | `true` lets `POST /claims` take an `x-inject-failure` header (demo and evals only; keep `false` anywhere real) |

**ClaimPilot's own API keys.** Every request carries an `x-api-key` header; `API_KEYS` maps each key to a role
(`claimant` submits claims, `reviewer` sees the review queue and evaluations). The defaults are fine on your
machine. To use your own, generate random keys and put the same values in both apps:

```bash
openssl rand -hex 24      # run twice: one claimant key, one reviewer key
```

```env
# claimpilot-api/.env
API_KEYS=claimant:<claimant-key>,reviewer:<reviewer-key>
# claimpilot-web/.env
VITE_CLAIMANT_API_KEY=<claimant-key>
VITE_REVIEWER_API_KEY=<reviewer-key>
```

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

**Development** (reloads on save), two terminals:

```bash
# terminal 1: API on http://localhost:3000 (Swagger at /docs)
cd claimpilot-api && nvm use && npm run start:dev

# terminal 2: web app on http://localhost:5173
cd claimpilot-web && nvm use && npm run dev
```

**Built, as it would be deployed:**

```bash
cd claimpilot-api && npm run build && npm run start:prod      # node dist/main
cd claimpilot-web && npm run build && npm run preview          # serves dist/ on http://localhost:4173
```

For `preview`, add `http://localhost:4173` to `CORS_ORIGINS` in the API's `.env`
(`CORS_ORIGINS=http://localhost:5173,http://localhost:4173`).

**Failure demo:** set `ALLOW_FAILURE_INJECTION=true` in the API's `.env`, restart, and send a claim with
`-H 'x-inject-failure: weather'` (or `intake`, `orchestrator`, `policy`, `flight`, `integrity`; see the README).

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
7. **Missing details** → **Need info** with questions. As Claimant, answer in the **Reply with the missing
   details** box (e.g. "6E-2134 from Mumbai on <a recent date>, 4 hours late, technical fault"): the same claim is
   triaged again and the trace continues below the first run.
8. Submit **Delay payout** a second time: the duplicate is **Rejected** because the first one was already paid.
9. Try **Prompt injection** (the text tells the model to set the delay to 600 minutes and approve the maximum):
   the claim page and trace flag the injected instructions, Intake extracts the 1 hour actually described, and
   the rules pay the tier the 3h50m flight record reaches, like any other claim. (Each example uses its own
   date, so trying one never makes another a duplicate.)
10. Switch the top bar to **Reviewer**: **Review queue** appears in the sidebar with every referred claim. Pick
   one, choose a decision (and payout tier), add a note and record it. The claim page then shows the review.
11. **Claims** in the sidebar lists every claim, newest first, with where it stands (triaging, decided, in
    review, reviewed) and the payout; filter by customer (e.g. `C-1042`) and click a row to open it.
12. After an eval run (step 7b), **Evaluations** in the sidebar shows its metrics, confusion matrix and cases.

If step 4 ends in **Referred**, the model call failed; the API terminal shows why (usually a bad key or a rate
limit, see below).

## 7. Tests

No API key, Docker or running server needed: tests use an in-memory MongoDB and a mock language model.

```bash
cd claimpilot-api && npm test     # first run downloads a MongoDB binary (~100 MB)
cd claimpilot-web && npm test
npm run lint                      # in either app
```

## 7b. Evals (needs a model key and MongoDB)

Evals run the real agents, so they use the model quota: about 5 calls per case, 19 cases, paced at
`MODEL_REQUESTS_PER_MINUTE`, so roughly 10 minutes per pass on the Gemini free tier (don't run two at once; each
process paces itself). Results appear under **Evaluations** (Reviewer role) in the web app.

```bash
cd claimpilot-api
npm run eval                        # once per case; --repeat 3 for flakiness, --judge for explanation scores
npm run eval -- --update-baseline   # accept the run as the new baseline
npm run eval:export-reviews         # resolved reviews → evals/cases/reviewed/*.json
```

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid environment configuration: ...` at startup | Missing or malformed `.env` value | Fix the listed variables |
| `/health` returns 503 `MongoDB not connected` | Mongo not running or wrong URI | `docker compose up -d mongo`; check `MONGO_URI` |
| `no configuration file provided: not found` | `docker compose` run outside the `claimpilot/` folder | `cd claimpilot` first, or `docker compose -f ../docker-compose.yml up -d mongo` from an app folder |
| `Bind for 0.0.0.0:27017 failed: port is already allocated` | Another MongoDB already on 27017 | Use that one (same `MONGO_URI`), or stop it first |
| `Cannot connect to the Docker daemon` | Docker Desktop not running | Start Docker Desktop, or use MongoDB option B or C |
| Atlas: `bad auth : authentication failed` | Wrong user/password in `MONGO_URI`, or special characters not URL-encoded | Reset the database user's password; URL-encode `@ : / ?` |
| Atlas: `querySrv ENOTFOUND` / timeouts | Cluster address typo, or your IP isn't in Network Access | Copy the string again from **Connect**; add your current IP |
| `EADDRINUSE :3000` / `:27017` | Port already taken (another API or MongoDB) | Stop the other process, or change `PORT` (and `VITE_API_URL`) / the compose port mapping |
| Claims always end in **Referred** | Model call failing | Check the API log: `401/403` = bad key, `429` = rate limit, `404` = wrong model id |
| Claims slow down after a few runs | `MODEL_REQUESTS_PER_MINUTE` pacing (~8–11 model calls per claim) | Expected on the free tier: calls queue instead of failing |
| Claims end in **Referred** with a quota error in the log | Limit set higher than your project's real quota | Lower `MODEL_REQUESTS_PER_MINUTE` to your AI Studio limit minus one |
| `429` / "quota exceeded" | Free-tier limit hit | Per-minute: wait a minute. Daily ("retry in 18h"; resets at midnight Pacific): set `MODEL_FALLBACK`, or switch `MODEL` to another model, provider or Ollama |
| Demo flights "not found" | `FLIGHT_DATA_MODE=live`: real AeroDataBox data has no record matching the demo examples | Set `FLIGHT_DATA_MODE=fixtures` (the default) for demos; tests and evals always use recorded flights |
| Web shows **API · offline** | API not running, wrong `VITE_API_URL`, or CORS | Start the API; check `VITE_API_URL` and `CORS_ORIGINS` |
| Submitting returns `Requires role: claimant` | Role switch is on Reviewer | Switch to **Claimant** in the top bar |
| `Must use import to load ES Module` in tests | Wrong Node version | `nvm use` (Node 24) |
| Web build fails in `styleText` with `ERR_INVALID_ARG_VALUE ... Received [ 'underline', 'gray' ]` | Node older than 24 (e.g. 20.12): Vite's bundler needs a newer `util.styleText` | `nvm use` in the app folder (reads `.nvmrc`); `nvm alias default 24` so new terminals start on 24 |
| `npm install` fails with `EBADENGINE` | Node older than 24 (`engine-strict` is on) | `nvm use`, then install again |
| `ECONNREFUSED 127.0.0.1:11434` | Ollama not running | `ollama serve` |
| Weather agent always "unavailable" | MCP server can't start (no internet, `npx` blocked) | Run `npx -y open-meteo-mcp-server` by hand to see the error |
| AeroDataBox `403` / `429` in live mode | Not subscribed, wrong key, or monthly quota used | Check the RapidAPI subscription; switch back to `FLIGHT_DATA_MODE=fixtures` |

---

## Demo data (fictional)

| Policy | Holder | Notes |
|---|---|---|
| P-77 SkyGuard Standard | C-1042 | Delay from departure; 2h ₹2,000 · 4h ₹5,000 · 6h ₹10,000; excludes severe weather and strikes |
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

Recorded flights apply to any date. In the app, weather is live from Open-Meteo, so a "fog" claim on a clear day
is approved with the weather evidence as the reason; evals stub the weather so fog cases are repeatable.

## Appendix: free-tier limits and which provider to use

*Checked October 2026. Free tiers change often; confirm on the provider pages linked below.*

### What ClaimPilot asks of the model

| | Measured |
|---|---|
| LLM requests per claim | ~5–8 (Intake 1, orchestrator 2–3, policy 1–3, flight 1–2, weather 1–2 when needed) |
| Time per claim on Gemini Flash-Lite free tier | ~10–35 s (most of it waiting on the 14/min pacing) |
| Eval suite (19 cases × 1) | ~100–130 requests, ~10–25 minutes; ×3 for `--repeat 3`; +19 with `--judge` |

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

**For the demo of single claims: barely. For the eval suite: no.** (Figures below were estimated before the
agents were tuned to ~5–8 calls per claim; the token-per-minute limit is still the constraint.)

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
   fast; move to `gemini-3.8-flash` if it isn't returning `503`. Check your daily
   quota in AI Studio before the panel.
2. **Eval runs: Ollama** (`ollama:qwen2.5:7b`) when you need many runs, or Gemini if your daily quota allows.
3. **Groq: optional fallback only**, not the primary provider.

In place: request pacing under the quota (`MODEL_REQUESTS_PER_MINUTE`), an optional fallback model
(`MODEL_FALLBACK`) for quota and overload errors, and evals that count attempts lost to provider errors
separately instead of scoring them.

### Sources

- Groq free-tier limits (official): <https://console.groq.com/docs/rate-limits>
- Groq structured outputs (official): <https://console.groq.com/docs/structured-outputs>
- Gemini rate limits (official, limits shown per project): <https://ai.google.dev/gemini-api/docs/rate-limits>
- Gemini free-tier changes, Dec 2025: <https://www.howtogeek.com/gemini-slashed-free-api-limits-what-to-use-instead/>
- Gemini free-tier figures reported Sept 2026: <https://www.memetik.ai/guides/gemini-api-free-tier-limits>
- Groq free-tier changes in 2026: <https://klymentiev.com/blog/groq-pricing>
- Open-Meteo terms and free limits: <https://open-meteo.com/en/terms>
- Open-Meteo MCP server: <https://github.com/cmer81/open-meteo-mcp>
- AeroDataBox on RapidAPI: <https://rapidapi.com/aedbx-aedbx/api/aerodatabox>
