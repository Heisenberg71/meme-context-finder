import { describe, expect, it } from "vitest";
import { validateImageUpload } from "@/lib/validate";

const MAX = 4 * 1024 * 1024;

// A real 1x1 PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);
const JPEG_HEADER = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");
const GIF = new TextEncoder().encode("GIF89a\x01\x00\x01\x00\x00\x00\x00;");

function formWith(...files: [Uint8Array, string, string][]) {
  const form = new FormData();
  for (const [bytes, name, type] of files) form.append("image", new File([bytes as BlobPart], name, { type }));
  return form;
}

describe("validateImageUpload", () => {
  it("accepts a PNG", async () => {
    const r = await validateImageUpload(formWith([PNG, "a.png", "image/png"]), MAX);
    expect(r).toMatchObject({ ok: true, mime: "image/png" });
  });

  it("accepts a JPEG even if the name is wrong", async () => {
    const r = await validateImageUpload(formWith([JPEG_HEADER, "meme.txt", "text/plain"]), MAX);
    expect(r).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it("rejects a PDF renamed to .png", async () => {
    const r = await validateImageUpload(formWith([PDF, "fake.png", "image/png"]), MAX);
    expect(r).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects a raw GIF (the browser converts GIFs to JPEG first)", async () => {
    const r = await validateImageUpload(formWith([GIF, "a.gif", "image/gif"]), MAX);
    expect(r).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects more than one file", async () => {
    const r = await validateImageUpload(formWith([PNG, "a.png", "image/png"], [PNG, "b.png", "image/png"]), MAX);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects extra form fields such as a text prompt", async () => {
    const form = formWith([PNG, "a.png", "image/png"]);
    form.append("prompt", "explain this");
    expect(await validateImageUpload(form, MAX)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an empty form", async () => {
    expect(await validateImageUpload(new FormData(), MAX)).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects files over the size limit", async () => {
    const r = await validateImageUpload(formWith([PNG, "a.png", "image/png"]), 10);
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
});
