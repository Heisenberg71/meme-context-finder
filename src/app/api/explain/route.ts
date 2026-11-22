import type { NextRequest } from "next/server";
import { config } from "@/lib/config";
import { validateImageUpload } from "@/lib/validate";
import { store, type LimitRule } from "@/lib/store";
import {
  explainMeme,
  extractSources,
  friendlyGeminiError,
  geminiStatus,
  modelPool,
  searchGate,
  type GeminiChunk,
} from "@/lib/gemini";
import { AllModelsBusyError, startExplanation, type Started } from "@/lib/startExplanation";
import { CategoryParser, verifyCategory } from "@/lib/category";
import type { StreamEvent } from "@/lib/events";
import type { GroundingMetadata } from "@google/genai";

export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;

function jsonError(status: number, message: string, headers: HeadersInit = {}) {
  return Response.json({ error: message }, { status, headers });
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const started = Date.now();

  // Anonymous browser ID: counts unique users and keys the per-user limits.
  const existingId = req.cookies.get(config.anonCookieName)?.value;
  const userId = existingId && UUID_RE.test(existingId) ? existingId : crypto.randomUUID();
  const cookieHeader: Record<string, string> =
    userId === existingId
      ? {}
      : {
          "Set-Cookie": `${config.anonCookieName}=${userId}; Path=/; Max-Age=${config.anonCookieMaxAgeSeconds}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
        };

  // Reject oversized bodies before reading them.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > config.maxUploadBytes + 64 * 1024) {
    return jsonError(413, "Image is too large. The limit is 4 MB.", cookieHeader);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "Please upload a meme image.", cookieHeader);
  }

  const upload = await validateImageUpload(form, config.maxUploadBytes);
  if (!upload.ok) return jsonError(upload.status, upload.message, cookieHeader);

  const ip = clientIp(req);
  const { rateLimits: rl } = config;
  const rules: LimitRule[] = [
    { scope: "user", key: userId, limit: rl.perUserPerMinute, window: "1 m" },
    { scope: "ip", key: ip, limit: rl.perIpPerMinute, window: "1 m" },
    { scope: "user", key: userId, limit: rl.perUserPerDay, window: "1 d" },
    { scope: "ip", key: ip, limit: rl.perIpPerDay, window: "1 d" },
    { scope: "global", key: "all", limit: rl.globalPerMinute, window: "1 m" },
    { scope: "global", key: "all", limit: rl.globalPerDay, window: "1 d" },
  ];
  const limit = await store.checkLimits(rules);
  if (!limit.ok) {
    const message =
      limit.scope === "global"
        ? `The service is busy right now. Please try again in ${limit.retryAfterSeconds} seconds.`
        : `You've reached the limit. Please try again in ${limit.retryAfterSeconds} seconds.`;
    return jsonError(429, message, { ...cookieHeader, "Retry-After": String(limit.retryAfterSeconds) });
  }

  // Wait for Gemini's first chunk before answering, so failures such as an
  // exhausted quota come back as a proper HTTP error instead of a broken stream.
  // startExplanation handles search refusals, busy models and slow models.
  let gemini: Started<GeminiChunk>;
  try {
    gemini = await startExplanation<GeminiChunk>({
      explain: (model, search, signal) => explainMeme(upload.bytes, upload.mime, signal, search, model),
      pool: modelPool,
      gate: searchGate,
      signal: req.signal,
      hedgeAfterMs: config.hedgeAfterMs,
      statusOf: geminiStatus,
      log: (msg) => console.warn(`[explain] ${msg}`),
    });
  } catch (err) {
    if (err instanceof AllModelsBusyError) {
      console.warn("[explain] All models busy");
      return jsonError(503, `The service is busy right now. Please try again in ${err.retryAfterSeconds} seconds.`, {
        ...cookieHeader,
        "Retry-After": String(err.retryAfterSeconds),
      });
    }
    console.error("[explain] Gemini request failed", err);
    const { status, message } = friendlyGeminiError(err);
    return jsonError(status, message, cookieHeader);
  }
  const { iterator, first, model, withSearch } = gemini;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const parser = new CategoryParser();
      const grounding: GroundingMetadata[] = [];
      let firstTokenMs: number | null = null;

      const handle = (out: ReturnType<CategoryParser["push"]>) => {
        if (out.category) send({ type: "category", value: out.category });
        if (out.text) {
          firstTokenMs ??= Date.now() - started;
          send({ type: "text", text: out.text });
        }
      };

      try {
        send({ type: "mode", search: withSearch });
        let result = first;
        while (!result.done) {
          if (result.value.grounding) grounding.push(result.value.grounding);
          handle(parser.push(result.value.text));
          result = await iterator.next();
        }
        handle(parser.flush());

        const sources = extractSources(grounding);
        const claimed = parser.category ?? 2;
        // The "no sources" check only means something when search actually ran.
        const verified = withSearch ? verifyCategory(claimed, sources.length) : claimed;
        if (verified !== claimed) send({ type: "category", value: verified, adjusted: true });
        if (sources.length) send({ type: "sources", sources });

        // Only a complete explanation counts toward the counters.
        try {
          await store.recordExplanation(userId);
        } catch (err) {
          console.error("[explain] Failed to update counters", err);
        }
        console.info(`[explain] done model=${model} search=${withSearch} firstTokenMs=${firstTokenMs} totalMs=${Date.now() - started}`);
        send({ type: "done", firstTokenMs, model });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[explain] Stream failed", err);
          send({ type: "error", message: friendlyGeminiError(err).message });
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      void iterator.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      ...cookieHeader,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
