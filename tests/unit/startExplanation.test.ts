import { describe, expect, it } from "vitest";
import { ModelPool, parseModelList, retryDelayMs } from "@/lib/modelPool";
import { SearchGate } from "@/lib/searchMode";
import { AllModelsBusyError, startExplanation, type ExplainFn } from "@/lib/startExplanation";

type Behaviour = { delay?: number; fail?: number; failWithSearch?: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const err = (status: number, message = `status ${status}`) => Object.assign(new Error(message), { status });

/** Fake Gemini: each model has a delay and optionally fails with a status code. */
function fakeGemini(behaviour: Record<string, Behaviour>) {
  const calls: { model: string; search: boolean; signal: AbortSignal }[] = [];
  const explain: ExplainFn<string> = async function* (model, search, signal) {
    calls.push({ model, search, signal });
    const b = behaviour[model] ?? {};
    await sleep(b.delay ?? 5);
    if (search && b.failWithSearch) throw err(b.failWithSearch);
    if (b.fail) throw err(b.fail);
    yield `${model}:${search ? "search" : "plain"}`;
  };
  return { explain, calls };
}

function run(models: string[], behaviour: Record<string, Behaviour>, opts: { hedge?: number; pool?: ModelPool; gate?: SearchGate } = {}) {
  const fake = fakeGemini(behaviour);
  const pool = opts.pool ?? new ModelPool(models);
  const promise = startExplanation({
    explain: fake.explain,
    pool,
    gate: opts.gate ?? new SearchGate("off", 1000),
    signal: new AbortController().signal,
    hedgeAfterMs: opts.hedge ?? 1000,
    statusOf: (e) => (e as { status?: number }).status,
  });
  return { promise, calls: fake.calls, pool };
}

describe("startExplanation", () => {
  it("uses the first model when it answers", async () => {
    const { promise, calls } = run(["a", "b"], {});
    const started = await promise;
    expect(started.model).toBe("a");
    expect(started.first.value).toBe("a:plain");
    expect(calls.map((c) => c.model)).toEqual(["a"]);
  });

  it("moves to the next model when one is over quota, and skips it afterwards", async () => {
    const pool = new ModelPool(["a", "b"]);
    const first = run(["a", "b"], { a: { fail: 429 } }, { pool });
    expect((await first.promise).model).toBe("b");
    expect(pool.available()).toEqual(["b"]);

    const second = run(["a", "b"], {}, { pool });
    await second.promise;
    expect(second.calls.map((c) => c.model)).toEqual(["b"]);
  });

  it("races a backup model when the first is slow, and cancels the loser", async () => {
    const { promise, calls } = run(["slow", "fast"], { slow: { delay: 300 }, fast: { delay: 10 } }, { hedge: 30 });
    const started = await promise;
    expect(started.model).toBe("fast");
    expect(calls.find((c) => c.model === "slow")?.signal.aborted).toBe(true);
    expect(calls.find((c) => c.model === "fast")?.signal.aborted).toBe(false);
  });

  it("keeps the first model if it answers before the backup", async () => {
    const { promise, calls } = run(["a", "b"], { a: { delay: 60 }, b: { delay: 300 } }, { hedge: 30 });
    expect((await promise).model).toBe("a");
    expect(calls.find((c) => c.model === "b")?.signal.aborted).toBe(true);
  });

  it("retries the same model without search when search is refused", async () => {
    const gate = new SearchGate("auto", 60_000);
    const { promise, calls } = run(["a", "b"], { a: { failWithSearch: 429 } }, { gate });
    const started = await promise;
    expect(started).toMatchObject({ model: "a", withSearch: false });
    expect(calls.map((c) => [c.model, c.search])).toEqual([["a", true], ["a", false]]);
    expect(gate.shouldSearch()).toBe(false);
  });

  it("reports all models busy with a retry time", async () => {
    const { promise } = run(["a", "b"], { a: { fail: 429 }, b: { fail: 503 } });
    await expect(promise).rejects.toBeInstanceOf(AllModelsBusyError);
  });

  it("fails straight away on errors other models can't fix, such as a bad image", async () => {
    const { promise, calls } = run(["a", "b"], { a: { fail: 400 } });
    await expect(promise).rejects.toMatchObject({ status: 400 });
    expect(calls.map((c) => c.model)).toEqual(["a"]);
  });

  it("throws busy immediately when every model is on cooldown", async () => {
    const pool = new ModelPool(["a"]);
    pool.markBusy("a", 5000);
    const { promise, calls } = run(["a"], {}, { pool });
    const e = await promise.catch((x) => x);
    expect(e).toBeInstanceOf(AllModelsBusyError);
    expect(e.retryAfterSeconds).toBe(5);
    expect(calls).toHaveLength(0);
  });
});

describe("retryDelayMs", () => {
  it("reads Google's retry hint from an escaped error message", () => {
    const message = String.raw`{"error":{"message":"{\n \"details\": [{\"@type\": \"RetryInfo\", \"retryDelay\": \"55s\"}]}"}}`;
    expect(retryDelayMs(new Error(message))).toBe(55_000);
  });
  it("falls back when there's no hint", () => {
    expect(retryDelayMs(new Error("nope"), 1234)).toBe(1234);
  });
});

describe("parseModelList", () => {
  it("prefers the list, then the single model, then the default", () => {
    expect(parseModelList("x, y", "z", ["d"])).toEqual(["x", "y"]);
    expect(parseModelList(undefined, "z", ["d"])).toEqual(["z"]);
    expect(parseModelList("", undefined, ["d"])).toEqual(["d"]);
  });
});
