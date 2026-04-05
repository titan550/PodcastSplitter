import { splitExt } from "./supportedFormats";

const MAX_FILENAME = 150;

export function deriveTitle(file: File): string {
  const ext = splitExt(file.name);
  const stem = ext ? file.name.slice(0, -ext.length) : file.name;
  return stem.replace(/[_-]+/g, " ").trim() || "Podcast";
}

export function sanitizeFilename(name: string): string {
  return (
    name
      // eslint-disable-next-line no-control-regex -- strip filesystem-invalid control chars
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100)
  );
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

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd();
}

/**
 * Last-resort safety net that caps a pre-composed filename at maxLen
 * while preserving the extension. Callers inside this module (partFilename,
 * zipFilename) budget ahead of time, so in practice only zipFilename with
 * a pathologically long title would hit this.
 */
export function truncateFilename(name: string, maxLen = MAX_FILENAME): string {
  if (name.length <= maxLen) return name;
  const ext = splitExt(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return stem.slice(0, maxLen - ext.length).trimEnd() + ext;
}

/**
 * Deterministic filename for a single part.
 *
 * Time mode:     "{hash} {num} {title} - Part {num}.mp3"
 * Chapter mode:  "{hash} {num} {title} - {num} {chapter}.mp3"
 *
 * The leading hash groups parts of the same podcast together when an
 * audio player sorts files from multiple podcasts alphabetically. The
 * numeric index appears twice (once after the hash for sort order, once
 * at the end for users whose player truncates long filenames).
 *
 * Title and chapter fragments are budgeted inside this function so the
 * final name never exceeds MAX_FILENAME. Title gets up to 60% of the
 * available budget in chapter mode; chapter gets the rest.
 */
export function partFilename(
  partIndex: number,
  totalParts: number,
  title: string,
  chapterTitle?: string,
): string {
  const hash = titleHash(title);
  const padWidth = Math.max(String(totalParts).length, 2);
  const num = String(partIndex + 1).padStart(padWidth, "0");
  const ext = ".mp3";
  const safeTitleFull = sanitizeFilename(title);

  if (chapterTitle !== undefined) {
    let safeChapter = sanitizeFilename(chapterTitle);
    if (!safeChapter) safeChapter = `Chapter ${num}`;
    // Fixed overhead: hash + " " + num + " " + " - " + num + " " + ext
    const fixed = hash.length + 1 + num.length + 1 + 3 + num.length + 1 + ext.length;
    const budget = MAX_FILENAME - fixed;
    const titleBudget = Math.max(5, Math.floor(budget * 0.6));
    const safeTitle = clip(safeTitleFull, titleBudget);
    const chapterBudget = Math.max(5, budget - safeTitle.length);
    safeChapter = clip(safeChapter, chapterBudget);
    return `${hash} ${num} ${safeTitle} - ${num} ${safeChapter}${ext}`;
  }

  // Fixed overhead: hash + " " + num + " " + " - Part " + num + ext
  const fixed = hash.length + 1 + num.length + 1 + 8 + num.length + ext.length;
  const budget = MAX_FILENAME - fixed;
  const safeTitle = clip(safeTitleFull, budget);
  return `${hash} ${num} ${safeTitle} - Part ${num}${ext}`;
}

export function zipFilename(title: string): string {
  const hash = titleHash(title);
  const safe = sanitizeFilename(title);
  return truncateFilename(`${hash} ${safe}.zip`);
}
