import { describe, expect, it } from "vitest";
import { extractSources } from "@/lib/gemini";

describe("extractSources", () => {
  it("deduplicates sources and falls back to the hostname for a title", () => {
    const sources = extractSources([
      { groundingChunks: [{ web: { uri: "https://knowyourmeme.com/x", title: "KYM" } }] },
      { groundingChunks: [{ web: { uri: "https://knowyourmeme.com/x", title: "KYM" } }, { web: { uri: "https://example.org/a" } }] },
    ]);
    expect(sources).toEqual([
      { uri: "https://knowyourmeme.com/x", title: "KYM" },
      { uri: "https://example.org/a", title: "example.org" },
    ]);
  });
});
