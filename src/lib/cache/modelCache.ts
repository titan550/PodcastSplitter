import { clearBlobCache } from "./blobCache";

export interface CacheInfo {
  blobCache: "cleared" | "failed";
  voiceModel: "cleared" | "failed";
}

export async function clearAllCaches(): Promise<CacheInfo> {
  const result: CacheInfo = { blobCache: "failed", voiceModel: "failed" };
  try {
    await clearBlobCache();
    result.blobCache = "cleared";
  } catch {
    // leave as failed
  }
  try {
    // flush() deletes the Piper voice model from OPFS (best-effort, never
    // throws). The ffmpeg/ORT WASM are in the HTTP cache — not JS-clearable.
    const { flush } = await import("@mintplex-labs/piper-tts-web");
    await flush();
    result.voiceModel = "cleared";
  } catch {
    // leave as failed
  }
  return result;
}

export const FIRST_RUN_DOWNLOADS: readonly {
  label: string;
  sizeMB: number;
}[] = [
  { label: "FFmpeg WASM", sizeMB: 25 },
  { label: "ONNX Runtime WASM", sizeMB: 8 },
  // en_US-amy-low.onnx is ~63 MB on the wire.
  { label: "Piper voice model", sizeMB: 63 },
];
