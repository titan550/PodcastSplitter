import { parseBlob } from "music-metadata";
import { deriveTitle } from "./filename";
import { downscaleCover } from "./coverArt";
import { sanitizeTagValue } from "./tagBuilder";
import type { Chapter, PodcastMetadata, SourceMetadata } from "../types";

/** Extract the SourceMetadata subset from a PodcastMetadata. */
export function toSourceMetadata(meta: PodcastMetadata): SourceMetadata {
  return {
    sampleRate: meta.sampleRate,
    numberOfChannels: meta.numberOfChannels,
    artist: meta.artist,
    albumartist: meta.albumartist,
    album: meta.album,
    date: meta.date,
    genre: meta.genre,
    comment: meta.comment,
    composer: meta.composer,
    publisher: meta.publisher,
    copyright: meta.copyright,
    language: meta.language,
    coverArt: meta.coverArt,
  };
}

/** Cap long comment fields so they don't bloat every part's ID3 header. */
const MAX_COMMENT_LENGTH = 500;

/** Hard cap on chapters — guards the synchronous planner and chapter-list
 *  render against corrupt CHAP frame counts. */
const MAX_CHAPTERS = 500;

/** Pick the best cover picture from an array of embedded images. */
function pickCover(
  pictures: Array<{ format: string; data: Uint8Array; type?: string }>,
): { format: string; data: Uint8Array } | undefined {
  if (pictures.length === 0) return undefined;
  return (
    pictures.find((p) => p.type === "Cover (front)") ?? pictures[0]
  );
}

export async function extractMetadata(file: File): Promise<PodcastMetadata> {
  const metadata = await parseBlob(file);

  const durationSec = metadata.format.duration ?? 0;

  // Chapters — music-metadata surfaces ID3v2 CHAP frames and MP4 chapter
  // atoms. We drop the parser's optional end field and derive chapter ends
  // from the next chapter's start in planCutsFromChapters. Sanitize corrupt
  // data: drop non-finite/negative/past-EOF starts, sort, cap count.
  const rawChapters = metadata.format.chapters ?? [];
  const chapters: Chapter[] = rawChapters
    .map((c) => ({ title: c.title ?? "", start: c.start ?? 0 }))
    .filter(
      (c) =>
        Number.isFinite(c.start) &&
        c.start >= 0 &&
        (durationSec <= 0 || c.start < durationSec),
    )
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CHAPTERS);

  const c = metadata.common;

  // Comment — take first entry's text, sanitize, cap length.
  const rawComment = c.comment?.[0]?.text;
  const comment = rawComment
    ? sanitizeTagValue(rawComment)
        ?.slice(0, MAX_COMMENT_LENGTH)
        // Drop a trailing lone high surrogate left by the slice (invalid UTF-16).
        .replace(/[\uD800-\uDBFF]$/, "")
    : undefined;

  // Cover art — pick best picture, downscale to ~300×300 JPEG.
  const rawPicture = pickCover((c.picture ?? []) as Array<{ format: string; data: Uint8Array; type?: string }>);
  const coverArt = rawPicture ? await downscaleCover(rawPicture) : undefined;

  return {
    title: c.title || deriveTitle(file),
    durationSec,
    fileSizeBytes: file.size,
    chapters,

    sampleRate: metadata.format.sampleRate,
    numberOfChannels: metadata.format.numberOfChannels,
    bitrate: metadata.format.bitrate,

    artist: sanitizeTagValue(c.artist),
    albumartist: sanitizeTagValue(c.albumartist),
    album: sanitizeTagValue(c.album),
    // Sanitize each candidate so a whitespace-only date still falls back to year.
    date: sanitizeTagValue(c.date) ?? sanitizeTagValue(c.year?.toString()),
    genre: c.genre?.[0] ? sanitizeTagValue(c.genre[0]) : undefined,
    comment,
    composer: c.composer?.length ? sanitizeTagValue(c.composer.join(", ")) : undefined,
    publisher: c.publisher?.length ? sanitizeTagValue(c.publisher[0]) : undefined,
    copyright: sanitizeTagValue(c.copyright),
    language: sanitizeTagValue(c.language),
    coverArt,
  };
}
