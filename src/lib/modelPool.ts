// Tracks which Gemini models are usable right now. Each free-tier model has
// its own per-minute quota, so when one is busy the next can take over.

export class ModelPool {
  private busyUntil = new Map<string, number>();

  constructor(
    readonly models: string[],
    private now: () => number = Date.now,
  ) {}

  /** Models not on cooldown, in preference order. */
  available(): string[] {
    const t = this.now();
    return this.models.filter((m) => (this.busyUntil.get(m) ?? 0) <= t);
  }

  /** Models currently on cooldown, with seconds left. For logging. */
  cooldowns(): { model: string; seconds: number }[] {
    const t = this.now();
    return this.models
      .filter((m) => (this.busyUntil.get(m) ?? 0) > t)
      .map((m) => ({ model: m, seconds: Math.ceil(((this.busyUntil.get(m) ?? 0) - t) / 1000) }));
  }

  markBusy(model: string, ms: number) {
    this.busyUntil.set(model, this.now() + ms);
  }

  /** Seconds until the first model comes off cooldown. */
  secondsUntilAvailable(): number {
    const t = this.now();
    const soonest = Math.min(...this.models.map((m) => this.busyUntil.get(m) ?? 0));
    return Math.max(1, Math.ceil((soonest - t) / 1000));
  }
}

/** Reads Google's "retryDelay": "55s" hint from a quota error, if present. */
export function retryDelayMs(err: unknown, fallbackMs = 60_000): number {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/retryDelay\\?"\s*:\s*\\?"(\d+(?:\.\d+)?)s/);
  return match ? Math.ceil(Number(match[1]) * 1000) : fallbackMs;
}

export function parseModelList(list: string | undefined, single: string | undefined, fallback: string[]): string[] {
  const fromList = (list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fromList.length) return fromList;
  if (single?.trim()) return [single.trim()];
  return fallback;
}
