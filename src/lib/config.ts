import { parseModelList } from "./modelPool";

// Central place for every tunable value. Anything that depends on Google's
// free-tier quotas is an env var, because those quotas change over time.

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  // Tried in order. Each free-tier model has its own per-minute quota, so when
  // one is busy or slow the next takes over. GEMINI_MODEL (one model) also works.
  geminiModels: parseModelList(process.env.GEMINI_MODELS, process.env.GEMINI_MODEL, [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
  ]),
  // If the first model hasn't started answering after this long, race the next one.
  hedgeAfterMs: intFromEnv("HEDGE_AFTER_MS", 2500),
  // "auto" | "on" | "off". See src/lib/searchMode.ts.
  geminiSearch: process.env.GEMINI_SEARCH,
  // After Google refuses search, skip it for this long before trying again.
  searchCooldownMs: intFromEnv("SEARCH_COOLDOWN_MINUTES", 10) * 60_000,

  // Vercel rejects request bodies over 4.5 MB, so stay under it.
  // The browser normally shrinks images to well under 1 MB before upload.
  maxUploadBytes: 4 * 1024 * 1024,

  rateLimits: {
    perUserPerMinute: intFromEnv("LIMIT_USER_PER_MINUTE", 5),
    perUserPerDay: intFromEnv("LIMIT_USER_PER_DAY", 30),
    // Looser than per-user, so people sharing a network aren't blocked,
    // but clearing cookies doesn't give unlimited requests.
    perIpPerMinute: intFromEnv("LIMIT_IP_PER_MINUTE", 10),
    perIpPerDay: intFromEnv("LIMIT_IP_PER_DAY", 60),
    // Set these to match your Gemini free-tier quota. Tested in Nov 2026: 5 per
    // minute per model, so 3 models give about 15 (some go to backup requests).
    globalPerMinute: intFromEnv("LIMIT_GLOBAL_PER_MINUTE", 12),
    globalPerDay: intFromEnv("LIMIT_GLOBAL_PER_DAY", 250),
  },

  anonCookieName: "mcf_uid",
  anonCookieMaxAgeSeconds: 60 * 60 * 24 * 365 * 2,
} as const;
