import { clearBlobCache } from "./blobCache";

export interface CacheInfo {
  blobCacheCleared: boolean;
}

export async function clearAllCaches(): Promise<CacheInfo> {
  let blobCacheCleared = false;
  try {
    await clearBlobCache();
    blobCacheCleared = true;
  } catch {
    // ignore
  }

  // OPFS cleanup for piper-tts-web is not exposed via its API.
  // Users can clear site data via browser settings if needed.

  return { blobCacheCleared };
}

export function estimateFirstRunDownloads(): {
  label: string;
  sizeMB: number;
}[] {
  return [
    { label: "FFmpeg WASM", sizeMB: 25 },
    { label: "ONNX Runtime WASM", sizeMB: 8 },
    { label: "Piper voice model", sizeMB: 17 },
  ];
}
