import { describe, expect, it } from "vitest";
import { CategoryParser, verifyCategory } from "@/lib/category";

function run(chunks: string[]) {
  const p = new CategoryParser();
  let text = "";
  const categories: number[] = [];
  for (const c of [...chunks.map((c) => p.push(c)), p.flush()]) {
    text += c.text;
    if (c.category) categories.push(c.category);
  }
  return { text, categories, final: p.category };
}

describe("CategoryParser", () => {
  it("strips a marker that arrives in one chunk", () => {
    expect(run(["[[CATEGORY:1]]\nGot it.\n\nDetails"])).toEqual({
      text: "Got it.\n\nDetails",
      categories: [1],
      final: 1,
    });
  });

  it("strips a marker split across chunks", () => {
    const r = run(["[[CATE", "GORY:", "3]]", "\nNo luck."]);
    expect(r.text).toBe("No luck.");
    expect(r.final).toBe(3);
  });

  it("tolerates Markdown around the marker", () => {
    expect(run(["**[[CATEGORY:2]]**\nPartly."]).text).toBe("Partly.");
  });

  it("falls back to category 2 and keeps the text when the marker is missing", () => {
    const r = run(["This meme is about cats."]);
    expect(r.text).toBe("This meme is about cats.");
    expect(r.final).toBe(2);
  });

  it("releases held text if the stream ends mid-marker", () => {
    const r = run(["[[CATEG"]);
    expect(r.text).toBe("[[CATEG");
    expect(r.final).toBe(2);
  });
});

describe("verifyCategory", () => {
  it("lowers category 1 when there are no sources", () => {
    expect(verifyCategory(1, 0)).toBe(2);
  });
  it("keeps category 1 when sources exist", () => {
    expect(verifyCategory(1, 3)).toBe(1);
  });
  it("leaves categories 2 and 3 alone", () => {
    expect(verifyCategory(2, 0)).toBe(2);
    expect(verifyCategory(3, 0)).toBe(3);
  });
});
