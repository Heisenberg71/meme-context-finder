// Decides whether to ask Gemini for Google Search grounding.
//
// GEMINI_SEARCH=auto (default): use search, but if Google refuses it for quota
//   reasons, answer from the model's own knowledge and stop trying search for
//   a cooldown period, so later requests don't pay for a failed attempt.
// GEMINI_SEARCH=on: always use search (fail if it's refused).
// GEMINI_SEARCH=off: never use search.

export type SearchSetting = "auto" | "on" | "off";

export function parseSearchSetting(raw: string | undefined): SearchSetting {
  return raw === "on" || raw === "off" ? raw : "auto";
}

export class SearchGate {
  private disabledUntil = 0;

  constructor(
    private setting: SearchSetting,
    private cooldownMs: number,
    private now: () => number = Date.now,
  ) {}

  /** Should this request try search? */
  shouldSearch(): boolean {
    if (this.setting === "off") return false;
    if (this.setting === "on") return true;
    return this.now() >= this.disabledUntil;
  }

  /** Search was refused. Returns true if the caller should retry without it. */
  reportRefused(): boolean {
    if (this.setting !== "auto") return false;
    this.disabledUntil = this.now() + this.cooldownMs;
    return true;
  }
}
