import { get, set, clear, createStore } from "idb-keyval";

const store = createStore("podcast-splitter-blob-cache", "blobs");

export function blobCacheKey(
  text: string,
  voiceId: string,
  engineVersion: string,
): string {
  return `${engineVersion}:${voiceId}:${text}`;
}

export async function getCachedBlob(
  key: string,
): Promise<Blob | undefined> {
  try {
    return await get<Blob>(key, store);
  } catch {
    return undefined;
  }
}

export async function setCachedBlob(
  key: string,
  blob: Blob,
): Promise<void> {
  try {
    await set(key, blob, store);
  } catch {
    // Quota exceeded or unavailable — skip caching
  }
}

export async function clearBlobCache(): Promise<void> {
  await clear(store);
}
