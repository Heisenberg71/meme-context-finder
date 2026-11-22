import { fileTypeFromBuffer } from "file-type";

// Formats Gemini accepts as image input. The browser converts GIF, BMP, AVIF
// and similar to JPEG before upload, so the server only needs these.
export const SERVER_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type ValidationResult =
  | { ok: true; mime: string; bytes: Uint8Array }
  | { ok: false; status: number; message: string };

/**
 * Checks an upload by its actual bytes, not its name or claimed type,
 * so a renamed .exe or .pdf is rejected.
 */
export async function validateImageUpload(
  form: FormData,
  maxBytes: number,
): Promise<ValidationResult> {
  const entries = [...form.entries()];
  const files = entries.filter(([, v]) => typeof v !== "string") as [string, File][];

  if (files.length === 0) {
    return { ok: false, status: 400, message: "Please upload a meme image." };
  }
  if (files.length > 1 || entries.length > 1) {
    return { ok: false, status: 400, message: "Upload one image at a time." };
  }

  const file = files[0][1];
  if (file.size === 0) {
    return { ok: false, status: 400, message: "That file is empty." };
  }
  if (file.size > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return { ok: false, status: 413, message: `Image is too large. The limit is ${mb} MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = await fileTypeFromBuffer(bytes);

  if (!detected || !SERVER_ALLOWED_MIME.has(detected.mime)) {
    return {
      ok: false,
      status: 415,
      message: "Only image files (PNG, JPG, JPEG, WEBP, HEIC) are accepted.",
    };
  }

  return { ok: true, mime: detected.mime, bytes };
}
