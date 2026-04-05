import type { ChapterCutInfo } from "../types";
import { splitExt } from "./supportedFormats";

const MAX_FILENAME = 150;

export function deriveTitle(file: File): string {
  const ext = splitExt(file.name);
  const stem = ext ? file.name.slice(0, -ext.length) : file.name;
  return stem.replace(/[_-]+/g, " ").trim() || "Podcast";
}

/**
 * Strict lowercase ASCII slug used for the variable portions of
 * partFilename. The output is safe across cheap MP3 players, POSIX
 * shells, rsync/cloud sync, ZIP tools, and every major filesystem.
 *
 * Rules (in order):
 *   1. NFKD-normalize and strip combining marks so accented letters
 *      collapse to their ASCII base ("café" → "cafe").
 *   2. Lowercase.
 *   3. Drop apostrophes / single-quotes *first* so "Don't" becomes
 *      "dont", not "don_t".
 *   4. Drop any remaining non-ASCII (emoji, symbols, CJK, …).
 *   5. Replace any run of whitespace or punctuation with a single "_".
 *   6. Collapse repeated "_".
 *   7. Trim leading / trailing "_".
 *
 * Returns the empty string for inputs that contain no sluggable chars.
 * Callers are responsible for substituting a context-aware fallback
 * (partFilename does this for the podcast and chapter slugs).
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
 * Deterministic filename for a single part. Slug-style lowercase ASCII
 * with underscores only — robust across cheap MP3 players, shells,
 * rsync/cloud sync, ZIP tools, and every major filesystem.
 *
 *  Time mode:
 *    {hash}_{globalIndex}_{podcast_slug}__part_{partNumber}.mp3
 *  Chapter, single part:
 *    {hash}_{globalIndex}_{podcast_slug}__ch_{chapterNumber}_{chapter_slug}.mp3
 *  Chapter, sub-part:
 *    {hash}_{globalIndex}_{podcast_slug}__ch_{chapterNumber}_{chapter_slug}__p_{index}_of_{count}.mp3
 *
 * The leading `globalIndex` guarantees that a basic lexicographic sort
 * (in a ZIP, a file manager, or on a cheap MP3 player) reproduces
 * playback order across the whole podcast, even when chapters are
 * subdivided.
 *
 * Structural fields (hash, global index, ch_/part_ number, sub-part
 * suffix, extension) are preserved under the 150-char cap; the podcast
 * slug is truncated first and the chapter slug second if overflow
 * remains. In the unreachable worst case, both slugs collapse to empty
 * and the structural fields still fit.
 */
export function partFilename(
  partIndex: number,
  totalParts: number,
  title: string,
  chapter?: ChapterCutInfo,
): string {
  const hash = titleHash(title);
  const globalIndex = padWidth(partIndex + 1, totalParts);
  const ext = ".mp3";
  const podcastSlug = slugFilenameSegment(title) || "untitled";

  if (!chapter) {
    const partNumber = padWidth(partIndex + 1, totalParts);
    const structural = `__part_${partNumber}${ext}`;
    const head = `${hash}_${globalIndex}_`;
    const podcast = fitSlug(
      podcastSlug,
      MAX_FILENAME - head.length - structural.length,
    );
    const headOut = podcast ? `${head}${podcast}` : head.replace(/_$/, "");
    return `${headOut}${structural}`;
  }

  const chapterNumStr = padWidth(chapter.number, chapter.totalChapters);
  const chapterSlug =
    slugFilenameSegment(chapter.title) || `chapter_${chapterNumStr}`;

  const subPartTail = chapter.part
    ? `__p_${chapter.part.index}_of_${chapter.part.count}`
    : "";
  // Structural tail: "__ch_{NN}_" + chapterSlug + subPartTail + ".mp3"
  // We split this into a fixed prefix ("__ch_{NN}_") and a sluggable
  // chapter segment that can be truncated independently.
  const chapterFixed = `__ch_${chapterNumStr}_`;
  const structuralTailFixed = `${chapterFixed}${subPartTail}${ext}`;
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
  // Empty chapter slug collapses "__ch_{NN}_" to "__ch_{NN}" so we don't
  // end with a dangling underscore before the sub-part tail or ext.
  const chapterSegment = chapterSlugOut
    ? `${chapterFixed}${chapterSlugOut}`
    : chapterFixed.replace(/_$/, "");
  return `${headOut}${chapterSegment}${subPartTail}${ext}`;
}

export function zipFilename(title: string): string {
  const hash = titleHash(title);
  const slug = slugFilenameSegment(title) || "untitled";
  return truncateFilename(`${hash}_${slug}.zip`);
}
