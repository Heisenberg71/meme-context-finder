import type { Category } from "./category";

export type Source = { title: string; uri: string };

/** One line of the newline-delimited JSON stream sent by /api/explain. */
export type StreamEvent =
  // Sent first: whether this answer used Google Search or only model knowledge.
  | { type: "mode"; search: boolean }
  | { type: "category"; value: Category; adjusted?: boolean }
  | { type: "text"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "done"; firstTokenMs: number | null; model: string }
  | { type: "error"; message: string };
