import { parseBlob } from "music-metadata";
import { deriveTitle } from "./filename";
import type { PodcastMetadata } from "../types";

export async function extractMetadata(file: File): Promise<PodcastMetadata> {
  const metadata = await parseBlob(file);
  return {
    title: metadata.common.title || deriveTitle(file),
    durationSec: metadata.format.duration ?? 0,
    bitrate: metadata.format.bitrate,
    sampleRate: metadata.format.sampleRate,
    fileSizeBytes: file.size,
  };
}
