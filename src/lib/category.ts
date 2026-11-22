export type Category = 1 | 2 | 3;

export const CATEGORY_LABELS: Record<Category, string> = {
  1: "Full context found",
  2: "Partly found, partly guessed",
  3: "No context found online",
};

// Used when the answer came from model knowledge only, so the badge
// doesn't claim anything was looked up online.
export const KNOWLEDGE_CATEGORY_LABELS: Record<Category, string> = {
  1: "Context recognized",
  2: "Partly recognized, partly guessed",
  3: "Context not recognized",
};

// Tolerates stray Markdown such as **[[CATEGORY:1]]** around the marker.
const MARKER = /^[\s*`]*\[\[CATEGORY:\s*([123])\s*\]\][*`]*\s*/;
// If the marker hasn't appeared after this many characters, the model ignored
// the format. Give up waiting and pass the text through.
const MAX_MARKER_WAIT = 40;

/**
 * Strips the hidden `[[CATEGORY:n]]` marker from the start of a text stream.
 * Text is held back only until the marker is found (a few characters), so
 * streaming isn't delayed noticeably.
 */
export class CategoryParser {
  private buffer = "";
  private resolved = false;
  // After the marker, drop whitespace until real text arrives (the marker's
  // line break can come in a later chunk).
  private trimLeading = false;
  category: Category | null = null;

  push(chunk: string): { text: string; category?: Category } {
    if (this.resolved) return { text: this.trim(chunk) };

    this.buffer += chunk;
    const match = this.buffer.match(MARKER);
    if (match) {
      this.resolved = true;
      this.category = Number(match[1]) as Category;
      this.trimLeading = true;
      const text = this.trim(this.buffer.slice(match[0].length));
      this.buffer = "";
      return { text, category: this.category };
    }

    const head = this.buffer.replace(/^[\s*`]+/, "").slice(0, 11);
    const couldStillBeMarker = "[[CATEGORY:".startsWith(head);
    if (this.buffer.length > MAX_MARKER_WAIT || !couldStillBeMarker) {
      return this.giveUp();
    }
    return { text: "" };
  }

  /** Call when the stream ends, to release anything still held back. */
  flush(): { text: string; category?: Category } {
    if (this.resolved) return { text: "" };
    return this.giveUp();
  }

  private trim(text: string): string {
    if (!this.trimLeading) return text;
    const trimmed = text.trimStart();
    if (trimmed) this.trimLeading = false;
    return trimmed;
  }

  private giveUp(): { text: string; category: Category } {
    this.resolved = true;
    // No self-reported category: treat it as partly guessed.
    this.category = 2;
    const text = this.buffer;
    this.buffer = "";
    return { text, category: 2 };
  }
}

/**
 * Category 1 claims the context was confirmed online. If the search returned
 * no sources, that claim isn't backed up, so it's lowered to category 2.
 */
export function verifyCategory(claimed: Category, sourceCount: number): Category {
  if (claimed === 1 && sourceCount === 0) return 2;
  return claimed;
}
