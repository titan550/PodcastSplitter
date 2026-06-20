import type { ChapterCutInfo } from "../types";
import { splitExt } from "./supportedFormats";

const MAX_FILENAME = 150;

export function deriveTitle(file: File): string {
  const ext = splitExt(file.name);
  const stem = ext ? file.name.slice(0, -ext.length) : file.name;
  return stem.replace(/[_-]+/g, " ").trim() || "Podcast";
}

/**
 * Strict lowercase-ASCII-with-underscores slug for the variable parts of a
 * filename — safe across cheap MP3 players, shells, cloud sync, ZIP tools,
 * and every major filesystem. Apostrophes are dropped first so "Don't" →
 * "dont" (not "don_t"); accents fold to ASCII via NFKD; remaining non-ASCII
 * is removed. Returns "" when nothing is sluggable — callers substitute
 * their own fallback.
 */
export function slugFilenameSegment(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Stable 4-char hash of the podcast title used as a filename prefix. Lets
 * several podcasts loaded into a single audio player group together
 * alphabetically (the player sorts by filename, and same-title parts share
 * the same hash prefix).
 *
 * djb2 accumulator followed by a MurmurHash3 32-bit finalizer so that
 * small input changes (e.g. "Podcast A" vs "Podcast B") propagate across
 * the full 32-bit range — otherwise the first 4 base36 chars of raw djb2
 * collide trivially for similar-suffix titles. Not cryptographic.
 */
export function titleHash(title: string): string {
  let h = 5381;
  for (let i = 0; i < title.length; i++) {
    h = (h * 33) ^ title.charCodeAt(i);
  }
  // MurmurHash3 fmix32 — good avalanche in 4 ops
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0).toString(36).slice(0, 4).padStart(4, "0");
}

/**
 * Last-resort safety net that caps a pre-composed filename at maxLen
 * while preserving the extension. partFilename budgets ahead of time and
 * shouldn't hit this; zipFilename uses it for pathologically long titles.
 */
export function truncateFilename(name: string, maxLen = MAX_FILENAME): string {
  if (name.length <= maxLen) return name;
  const ext = splitExt(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  // Extension alone exceeds budget — hard-cut, else slice(0, negative) would
  // overrun the cap.
  if (ext.length >= maxLen) return name.slice(0, maxLen);
  return stem.slice(0, maxLen - ext.length) + ext;
}

function padWidth(value: number, total: number): string {
  const width = Math.max(String(total).length, 2);
  return String(value).padStart(width, "0");
}

/** Trim a slug to fit a budget and strip any trailing underscore left
 *  by a mid-token slice. Never returns a string longer than budget. */
function fitSlug(slug: string, budget: number): string {
  if (budget <= 0) return "";
  if (slug.length <= budget) return slug;
  return slug.slice(0, budget).replace(/_+$/, "");
}

/**
 * Deterministic, sort-stable filename for one part (lowercase ASCII slug):
 *
 *  Time mode:         {hash}_{globalIndex}_{podcast}__part_{N}_of_{TOTAL}.mp3
 *  Chapter, 1 part:   …__part_{N}_of_{TOTAL}__ch_{C}_of_{TOTAL_CH}_{chapter}.mp3
 *  Chapter, sub-part: …__ch_{C}_of_{TOTAL_CH}_{chapter}__p_{index}_of_{count}.mp3
 *
 * The leading `globalIndex` makes a plain lexicographic sort reproduce
 * playback order; the trailing `__part_{N}_of_{TOTAL}` matches the spoken
 * announcement. Under the 150-char cap the podcast slug is truncated first,
 * the chapter slug second; structural fields are always preserved.
 */
export function partFilename(
  partIndex: number,
  totalParts: number,
  title: string,
  chapter?: ChapterCutInfo,
): string {
  const hash = titleHash(title);
  const globalIndex = padWidth(partIndex + 1, totalParts);
  const totalPartsPadded = padWidth(totalParts, totalParts);
  const ext = ".mp3";
  const podcastSlug = slugFilenameSegment(title) || "untitled";
  const partFixed = `__part_${globalIndex}_of_${totalPartsPadded}`;

  if (!chapter) {
    const structural = `${partFixed}${ext}`;
    const head = `${hash}_${globalIndex}_`;
    const podcast = fitSlug(
      podcastSlug,
      MAX_FILENAME - head.length - structural.length,
    );
    const headOut = podcast ? `${head}${podcast}` : head.replace(/_$/, "");
    return `${headOut}${structural}`;
  }

  const chapterNumStr = padWidth(chapter.number, chapter.totalChapters);
  const totalChaptersPadded = padWidth(chapter.totalChapters, chapter.totalChapters);
  const chapterSlug =
    slugFilenameSegment(chapter.title) || `chapter_${chapterNumStr}`;

  const subPartTail = chapter.part
    ? `__p_${chapter.part.index}_of_${chapter.part.count}`
    : "";
  // Fixed structural tail; the chapter slug between is truncated separately.
  const chapterFixed = `__ch_${chapterNumStr}_of_${totalChaptersPadded}_`;
  const structuralTailFixed = `${partFixed}${chapterFixed}${subPartTail}${ext}`;
  const head = `${hash}_${globalIndex}_`;

  // Budget: MAX_FILENAME = head + podcastSlug + chapterFixed + chapterSlugOut + subPartTail + ext
  // Truncation priority: preserve all structural fields; truncate
  // podcastSlug first, chapterSlug second only if the chapter on its own
  // still overflows.
  const slugBudget = MAX_FILENAME - head.length - structuralTailFixed.length;

  let podcast = podcastSlug;
  let chapterSlugOut = chapterSlug;

  if (podcast.length + chapterSlugOut.length > slugBudget) {
    if (chapterSlugOut.length >= slugBudget) {
      podcast = "";
      chapterSlugOut = fitSlug(chapterSlugOut, slugBudget);
    } else {
      podcast = fitSlug(podcast, slugBudget - chapterSlugOut.length);
    }
  }

  // Empty podcast slug collapses "head" ("{hash}_{globalIndex}_") to end
  // in a single underscore before the "__ch_" boundary, which would
  // produce "___ch_" — strip the trailing underscore from head in that
  // case so the separator remains the intended "__".
  const headOut = podcast ? `${head}${podcast}` : head.replace(/_$/, "");
  // Empty chapter slug collapses "__ch_{NN}_of_{DD}_" to "__ch_{NN}_of_{DD}"
  // so we don't end with a dangling underscore before the sub-part tail or ext.
  const chapterSegment = chapterSlugOut
    ? `${chapterFixed}${chapterSlugOut}`
    : chapterFixed.replace(/_$/, "");
  return `${headOut}${partFixed}${chapterSegment}${subPartTail}${ext}`;
}

export function zipFilename(title: string): string {
  const hash = titleHash(title);
  const slug = slugFilenameSegment(title) || "untitled";
  return truncateFilename(`${hash}_${slug}.zip`);
}
