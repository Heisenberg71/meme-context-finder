import { ApiError, GoogleGenAI, ThinkingLevel, type GroundingMetadata } from "@google/genai";
import { config } from "./config";
import { systemPrompt, USER_PROMPT } from "./prompt";
import { SearchGate, parseSearchSetting } from "./searchMode";
import { ModelPool } from "./modelPool";
import type { Source } from "./events";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return (client ??= new GoogleGenAI({ apiKey }));
}

export type GeminiChunk = { text: string; grounding?: GroundingMetadata };

const globalForGate = globalThis as unknown as { __mcfSearchGate?: SearchGate };
export const searchGate = (globalForGate.__mcfSearchGate ??= new SearchGate(
  parseSearchSetting(config.geminiSearch),
  config.searchCooldownMs,
));

const globalForPool = globalThis as unknown as { __mcfModelPool?: ModelPool };
export const modelPool = (globalForPool.__mcfModelPool ??= new ModelPool(config.geminiModels));

export function geminiStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}

/** Streams Gemini's explanation of a meme image, optionally with Google Search grounding. */
export async function* explainMeme(
  image: Uint8Array,
  mime: string,
  signal: AbortSignal,
  withSearch: boolean,
  model: string,
): AsyncGenerator<GeminiChunk> {
  const stream = await getClient().models.generateContentStream({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: Buffer.from(image).toString("base64") } },
          { text: USER_PROMPT },
        ],
      },
    ],
    config: {
      systemInstruction: systemPrompt(withSearch),
      tools: withSearch ? [{ googleSearch: {} }] : undefined,
      // Minimal thinking keeps the first tokens inside the 3-second target.
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      abortSignal: signal,
    },
  });

  for await (const chunk of stream) {
    const candidate = chunk.candidates?.[0];
    yield { text: chunk.text ?? "", grounding: candidate?.groundingMetadata };
  }
}

/** Pulls unique web sources out of grounding metadata. */
export function extractSources(metadata: GroundingMetadata[]): Source[] {
  const seen = new Map<string, Source>();
  for (const m of metadata) {
    for (const chunk of m.groundingChunks ?? []) {
      const uri = chunk.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.set(uri, { uri, title: chunk.web?.title || new URL(uri).hostname });
      }
    }
  }
  return [...seen.values()];
}

/** Turns a Gemini error into a message that's safe to show users. */
export function friendlyGeminiError(err: unknown): { status: number; message: string } {
  if (err instanceof ApiError) {
    if (err.status === 429 || err.status === 503) {
      return { status: 503, message: "The service is busy right now. Please try again in a minute." };
    }
    if (err.status === 400) {
      return { status: 422, message: "The AI couldn't read that image. Try a different one." };
    }
  }
  return { status: 502, message: "Something went wrong while explaining the meme. Please try again." };
}
