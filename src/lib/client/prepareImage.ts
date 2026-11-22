// Runs in the browser. Checks the picked file and shrinks it before upload,
// which keeps uploads small and fast (part of the 3-second target).

const MAX_SIDE = 1024;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const RAW_OK_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i;

export const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,.heic,.heif";

export type PreparedImage = { blob: Blob; previewUrl: string };

export class ImageRejectedError extends Error {}

/** True for raster image files. SVG is excluded: it's code, not a picture. */
export function looksLikeImage(file: File): boolean {
  if (file.type === "image/svg+xml") return false;
  if (file.type.startsWith("image/")) return true;
  // Some browsers report HEIC files with an empty type.
  return file.type === "" && IMAGE_EXT.test(file.name);
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!looksLikeImage(file)) {
    throw new ImageRejectedError("Only image files are accepted (PNG, JPG, JPEG, WEBP, GIF, HEIC…).");
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // This browser can't decode it (for example HEIC in Chrome). Send the
    // original if the server can take it; the server checks the bytes anyway.
    const mime = file.type || (/\.heic$/i.test(file.name) ? "image/heic" : "image/heif");
    if (RAW_OK_MIME.has(mime) && file.size <= MAX_UPLOAD_BYTES) {
      return { blob: file, previewUrl: "" };
    }
    throw new ImageRejectedError("That image couldn't be read. Try a PNG or JPG.");
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageRejectedError("Your browser couldn't process that image.");
  ctx.fillStyle = "#ffffff"; // Transparent PNGs get a white background, not black.
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new ImageRejectedError("Your browser couldn't process that image.");
  return { blob, previewUrl: URL.createObjectURL(blob) };
}
