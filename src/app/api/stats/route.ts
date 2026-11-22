import { connection } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  // Always read live counts; never prerender this route.
  await connection();
  try {
    const stats = await store.getStats();
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[stats] Failed to read counters", err);
    return Response.json({ error: "Counters unavailable" }, { status: 503 });
  }
}
