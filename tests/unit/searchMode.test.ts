import { describe, expect, it } from "vitest";
import { SearchGate, parseSearchSetting } from "@/lib/searchMode";
import { systemPrompt } from "@/lib/prompt";

describe("parseSearchSetting", () => {
  it("defaults to auto", () => {
    expect(parseSearchSetting(undefined)).toBe("auto");
    expect(parseSearchSetting("nonsense")).toBe("auto");
    expect(parseSearchSetting("off")).toBe("off");
  });
});

describe("SearchGate", () => {
  it("in auto mode, skips search during the cooldown after a refusal, then tries again", () => {
    let now = 0;
    const gate = new SearchGate("auto", 1000, () => now);
    expect(gate.shouldSearch()).toBe(true);
    expect(gate.reportRefused()).toBe(true);
    now = 999;
    expect(gate.shouldSearch()).toBe(false);
    now = 1000;
    expect(gate.shouldSearch()).toBe(true);
  });

  it("in on mode, always searches and never retries without it", () => {
    const gate = new SearchGate("on", 1000);
    expect(gate.reportRefused()).toBe(false);
    expect(gate.shouldSearch()).toBe(true);
  });

  it("in off mode, never searches", () => {
    expect(new SearchGate("off", 1000).shouldSearch()).toBe(false);
  });
});

describe("systemPrompt", () => {
  it("uses a prompt that forbids claiming a web search when search is off", () => {
    expect(systemPrompt(true)).toContain("Google Search");
    expect(systemPrompt(false)).toContain("do NOT have web search");
  });
});
