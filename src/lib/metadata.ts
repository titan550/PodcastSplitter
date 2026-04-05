import { parseBlob } from "music-metadata";
import { deriveTitle } from "./filename";
import type { Chapter, PodcastMetadata } from "../types";

export async function extractMetadata(file: File): Promise<PodcastMetadata> {
  const metadata = await parseBlob(file);
  // music-metadata surfaces ID3v2 CHAP frames and MP4 chapter atoms under
  // format.chapters. We drop the parser's optional end field and derive
  // chapter ends from the next chapter's start in planCutsFromChapters.
  const rawChapters = metadata.format.chapters ?? [];
  const chapters: Chapter[] = rawChapters
    .map((c) => ({ title: c.title ?? "", start: c.start ?? 0 }))
    .filter((c) => Number.isFinite(c.start));
  return {
    title: metadata.common.title || deriveTitle(file),
    durationSec: metadata.format.duration ?? 0,
    bitrate: metadata.format.bitrate,
    sampleRate: metadata.format.sampleRate,
    fileSizeBytes: file.size,
    chapters,
  };
}
