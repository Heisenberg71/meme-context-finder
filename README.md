# Meme Context Finder

Upload a meme image. Google Gemini searches the web for its context and explains it, streaming the answer as it's written. No login.

Every answer starts with one of three verdicts:

| Badge | Meaning |
|---|---|
| ✅ Full context found | The context was confirmed by web search results |
| 🟡 Partly found, partly guessed | Some context confirmed; the rest is labelled as guesses |
| ❌ No context found online | Nothing relevant found; the explanation is interpretation |

The top-left corner shows how many memes have been explained and how many unique users have used the site.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Google Gemini via `@google/genai`, with Google Search grounding and streaming
- Upstash Redis for the counters and rate limits
- Deployed on Vercel's free Hobby plan

## How it works

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system design diagram and a step-by-step walkthrough.

1. **Browser** (`src/lib/client/prepareImage.ts`): accepts one raster image (no SVG) and shrinks it to at most 1024px as a JPEG. Browsers that can't decode HEIC send the original file.
2. **`POST /api/explain`** (`src/app/api/explain/route.ts`):
   - checks the upload by its real bytes, not its name (`src/lib/validate.ts`): exactly one file, no other fields, PNG/JPEG/WEBP/HEIC/HEIF, up to 4 MB
   - applies rate limits per browser, per IP and site-wide (`src/lib/store.ts`)
   - streams Gemini's answer back as newline-delimited JSON events (`src/lib/events.ts`)
3. **Search fallback** (`src/lib/searchMode.ts`): some free-tier keys get no Google Search grounding quota. With `GEMINI_SEARCH=auto` (the default), if Google refuses search, the request is retried once without it, and search is skipped for `SEARCH_COOLDOWN_MINUTES` (default 10) before trying again. Those answers use a prompt that forbids claiming anything was looked up, the badges read "Context recognized / Partly recognized / Not recognized", and the page says web search was unavailable.
4. **Model fallback and racing** (`src/lib/startExplanation.ts`, `src/lib/modelPool.ts`): models in `GEMINI_MODELS` are tried in order. A model that's over quota (using Google's retry hint), overloaded or retired goes on cooldown and the next one answers. If the first model hasn't started answering within `HEDGE_AFTER_MS` (default 2.5s), a backup request to the next model starts in parallel; whichever answers first is used and the other is cancelled.
5. **Category check** (`src/lib/category.ts`): the model writes a hidden `[[CATEGORY:n]]` marker first, which becomes the badge. When search ran, a category 1 claim with no sources is lowered to 2.
6. **Counters**: when an explanation finishes, the meme count goes up by 1 and the anonymous browser ID (an httpOnly cookie) is added to a Redis set. Users = size of that set. `GET /api/stats` returns both.

Images are never stored.

## Run locally

```bash
npm install
cp .env.example .env.local   # then add your GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000. Without Upstash credentials, counters and rate limits run in memory and reset when the server restarts.

## Tests

```bash
npm test                                      # unit tests (Vitest)
npx playwright install chromium && npm run test:e2e   # browser tests (Playwright)
```

To use an installed Google Chrome instead of downloading Chromium: `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. The browser tests fake the Gemini response, so they don't need an API key.

## Deploy for free on Vercel

1. **Gemini key**: create one at https://aistudio.google.com/apikey.
2. **Redis**: create a free database at https://upstash.com (or add the Upstash integration from the Vercel Marketplace). Copy the REST URL and token.
3. **Vercel**: push this repo to GitHub, import it at https://vercel.com/new, and add these environment variables:
   - `GEMINI_API_KEY`
   - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the integration's `KV_REST_API_URL` / `KV_REST_API_TOKEN` names also work)
4. Deploy.

## Free-tier limits to check

Google changes Gemini's free-tier quotas often. Check the current limits for your model at https://ai.google.dev/gemini-api/docs/rate-limits, including the daily cap on Search grounding, and set:

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_MODELS` | `gemini-3.6-flash,gemini-3.5-flash,gemini-3.1-flash-lite` | Tried in order; each must support image input. `GEMINI_MODEL` sets a single model. |
| `HEDGE_AFTER_MS` | 2500 | Start a backup model if the first hasn't answered by then |
| `GEMINI_SEARCH` | `auto` | `auto` (search, fall back if refused), `on` or `off` |
| `SEARCH_COOLDOWN_MINUTES` | 10 | How long to skip search after it's refused |
| `LIMIT_USER_PER_MINUTE` / `_PER_DAY` | 5 / 30 | Per browser |
| `LIMIT_IP_PER_MINUTE` / `_PER_DAY` | 10 / 60 | Per IP (backstop if cookies are cleared) |
| `LIMIT_GLOBAL_PER_MINUTE` / `_PER_DAY` | 12 / 250 | Set to your Gemini quota (see below). |

Measured on a new free-tier key in Nov 2026:
- `gemini-3.6-flash` and `gemini-3.5-flash`: 5 requests per minute and **20 per day** each.
- `gemini-3.1-flash-lite`: answered every request in testing; its limits weren't reached.
- Google Search grounding: no free quota at all, so the search fallback is always used.

When a model hits its daily cap, Google's retry hint (hours) is followed, so the app stops calling it until the next day. Cooldowns are kept in memory per server instance, so each new Vercel instance spends one failed call to learn a model is busy.

Other notes:
- Vercel's Hobby plan is for non-commercial use only.
- Google may use free-tier Gemini inputs to improve its products. The site footer says so.

## The 3-second first-token target

To keep the wait short: images are shrunk before upload, Gemini runs with minimal thinking, text streams as soon as it arrives, and a backup model is raced after 2.5s. Each request logs `firstTokenMs` on the server, and the `done` event includes it too. Web search happens before the model writes, so check this number with real memes after deploying.
