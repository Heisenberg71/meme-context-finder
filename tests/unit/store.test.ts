import { describe, expect, it, vi } from "vitest";

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");

const { store } = await import("@/lib/store");

describe("in-memory store", () => {
  it("counts every explanation but each user only once", async () => {
    const before = await store.getStats();
    await store.recordExplanation("user-a");
    await store.recordExplanation("user-a");
    await store.recordExplanation("user-b");
    const after = await store.getStats();
    expect(after.memes - before.memes).toBe(3);
    expect(after.users - before.users).toBe(2);
  });

  it("blocks after the limit and reports which limit was hit", async () => {
    const rules = [{ scope: "user" as const, key: "limited", limit: 2, window: "1 m" as const }];
    expect(await store.checkLimits(rules)).toEqual({ ok: true });
    expect(await store.checkLimits(rules)).toEqual({ ok: true });
    const blocked = await store.checkLimits(rules);
    expect(blocked).toMatchObject({ ok: false, scope: "user" });
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
