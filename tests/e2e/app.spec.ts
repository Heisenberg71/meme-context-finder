import { expect, test } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

test("shows both counters in the top-left corner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Memes explained")).toBeVisible();
  await expect(page.getByText("Users", { exact: true })).toBeVisible();
});

test("rejects a non-image file in the browser", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "doc.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByRole("alert").filter({ hasText: "Only image files are accepted" })).toBeVisible();
});

test("server rejects a PDF disguised as a PNG", async ({ request }) => {
  const res = await request.post("/api/explain", {
    multipart: { image: { name: "fake.png", mimeType: "image/png", buffer: PDF } },
  });
  expect(res.status()).toBe(415);
  expect((await res.json()).error).toContain("Only image files");
});

test("server rejects an upload with a text prompt alongside the image", async ({ request }) => {
  const res = await request.post("/api/explain", {
    multipart: { image: { name: "a.png", mimeType: "image/png", buffer: PNG }, prompt: "hi" },
  });
  expect(res.status()).toBe(400);
});

test("streams the category badge, explanation and sources", async ({ page }) => {
  const events = [
    { type: "mode", search: true },
    { type: "category", value: 1 },
    { type: "text", text: "This is the **Distracted Boyfriend** meme.\n\n" },
    { type: "text", text: "## The joke\nHe ignores what he has for something new." },
    { type: "sources", sources: [{ title: "Know Your Meme", uri: "https://knowyourmeme.com/" }] },
    { type: "done", firstTokenMs: 900 },
  ];
  await page.route("**/api/explain", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    }),
  );

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "meme.png", mimeType: "image/png", buffer: PNG });

  await expect(page.getByText("Full context found")).toBeVisible();
  await expect(page.getByText("Distracted Boyfriend")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The joke" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Know Your Meme" })).toHaveAttribute("href", "https://knowyourmeme.com/");
});

test("shows a friendly message when rate limited", async ({ page }) => {
  await page.route("**/api/explain", (route) =>
    route.fulfill({ status: 429, json: { error: "You've reached the limit. Please try again in 42 seconds." } }),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "meme.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("alert").filter({ hasText: "try again in 42 seconds" })).toBeVisible();
});

test("labels answers made without web search honestly", async ({ page }) => {
  const events = [
    { type: "mode", search: false },
    { type: "category", value: 1 },
    { type: "text", text: "This is the **One Does Not Simply** meme." },
    { type: "done", firstTokenMs: 1200 },
  ];
  await page.route("**/api/explain", (route) =>
    route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" }),
  );
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "meme.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Context recognized")).toBeVisible();
  await expect(page.getByText("Full context found")).toHaveCount(0);
  await expect(page.getByText("Web search is unavailable right now")).toBeVisible();
});
