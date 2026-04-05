import type { CoverArt } from "../types";

/**
 * Downscale a source picture to a JPEG thumbnail suitable for embedding
 * as an MP3 APIC frame. Resizes to fit within maxDim x maxDim while
 * preserving aspect ratio.
 *
 * Returns undefined when the source is unreadable — callers fall back
 * to "no cover" rather than failing the job.
 */
export async function downscaleCover(
  picture: { data: Uint8Array; format: string },
  maxDim = 300,
): Promise<CoverArt | undefined> {
  try {
    const blob = new Blob([picture.data as BlobPart], { type: picture.format });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return undefined; }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const outBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.85,
    });
    return {
      data: new Uint8Array(await outBlob.arrayBuffer()),
      mimeType: "image/jpeg",
    };
  } catch {
    return undefined;
  }
}
