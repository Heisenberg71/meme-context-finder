import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Counters and rate limits live in Upstash Redis. With no Redis credentials
// (local development), an in-memory fallback is used so the app still runs;
// it resets on every restart and isn't shared between server instances.

const KEY_MEMES = "mcf:stats:memes";
const KEY_USERS = "mcf:stats:users";

export type Stats = { memes: number; users: number };

export type LimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number; scope: "user" | "ip" | "global" };

export type LimitRule = {
  scope: "user" | "ip" | "global";
  key: string;
  limit: number;
  window: "1 m" | "1 d";
};

interface Store {
  recordExplanation(userId: string): Promise<void>;
  getStats(): Promise<Stats>;
  checkLimits(rules: LimitRule[]): Promise<LimitResult>;
}

// ---------- Upstash Redis ----------

class RedisStore implements Store {
  private limiters = new Map<string, Ratelimit>();

  constructor(private redis: Redis) {}

  async recordExplanation(userId: string) {
    // Each browser ID is counted once in the set, so SCARD = unique users.
    await this.redis.pipeline().incr(KEY_MEMES).sadd(KEY_USERS, userId).exec();
  }

  async getStats(): Promise<Stats> {
    const [memes, users] = await this.redis
      .pipeline()
      .get<number>(KEY_MEMES)
      .scard(KEY_USERS)
      .exec<[number | null, number]>();
    return { memes: Number(memes ?? 0), users: Number(users ?? 0) };
  }

  async checkLimits(rules: LimitRule[]): Promise<LimitResult> {
    // Checked in order and stopped at the first block, so a request that is
    // already blocked doesn't use up the looser limits too.
    for (const rule of rules) {
      const res = await this.limiter(rule).limit(rule.key);
      if (!res.success) {
        return {
          ok: false,
          scope: rule.scope,
          retryAfterSeconds: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)),
        };
      }
    }
    return { ok: true };
  }

  private limiter(rule: LimitRule): Ratelimit {
    const id = `${rule.scope}:${rule.window}:${rule.limit}`;
    let limiter = this.limiters.get(id);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.limit, rule.window),
        prefix: `mcf:rl:${rule.scope}:${rule.window.replace(" ", "")}`,
      });
      this.limiters.set(id, limiter);
    }
    return limiter;
  }
}

// ---------- In-memory fallback ----------

class MemoryStore implements Store {
  private memes = 0;
  private users = new Set<string>();
  private hits = new Map<string, number[]>();

  async recordExplanation(userId: string) {
    this.memes += 1;
    this.users.add(userId);
  }

  async getStats(): Promise<Stats> {
    return { memes: this.memes, users: this.users.size };
  }

  async checkLimits(rules: LimitRule[]): Promise<LimitResult> {
    const now = Date.now();
    for (const rule of rules) {
      const windowMs = rule.window === "1 m" ? 60_000 : 86_400_000;
      const id = `${rule.scope}:${rule.window}:${rule.key}`;
      const recent = (this.hits.get(id) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= rule.limit) {
        this.hits.set(id, recent);
        return {
          ok: false,
          scope: rule.scope,
          retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)),
        };
      }
      recent.push(now);
      this.hits.set(id, recent);
    }
    return { ok: true };
  }
}

// ---------- Selection ----------

function createStore(): Store {
  // Vercel's Upstash integration may name these KV_REST_API_*.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) return new RedisStore(new Redis({ url, token }));

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[store] No Upstash credentials set: counters and rate limits are in memory and will reset.",
    );
  }
  return new MemoryStore();
}

const globalForStore = globalThis as unknown as { __mcfStore?: Store };
export const store: Store = (globalForStore.__mcfStore ??= createStore());
