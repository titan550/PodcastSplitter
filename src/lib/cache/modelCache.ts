import { clearBlobCache } from "./blobCache";

export interface CacheInfo {
  blobCache: "cleared" | "failed";
}

export async function clearAllCaches(): Promise<CacheInfo> {
  try {
    await clearBlobCache();
    return { blobCache: "cleared" };
  } catch {
    return { blobCache: "failed" };
  }
}

export const FIRST_RUN_DOWNLOADS: readonly {
  label: string;
  sizeMB: number;
}[] = [
  { label: "FFmpeg WASM", sizeMB: 25 },
  { label: "ONNX Runtime WASM", sizeMB: 8 },
  { label: "Piper voice model", sizeMB: 17 },
];
