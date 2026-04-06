import type { Chapter, CutPoint, SilenceInterval } from "../types";

const GRACE_WINDOW_SEC = 20;
const MIN_TRAILING_SEC = 30;

export function planCuts(
  totalDurationSec: number,
  targetPartSec: number,
  playbackSpeed: number,
  silences: SilenceInterval[],
): CutPoint[] {
  // Source audio needed per part: target output duration * speed
  // e.g., 5 min output at 1.25x needs 6.25 min of source
  const sourceDurationPerPart = targetPartSec * playbackSpeed;
  const cuts: CutPoint[] = [];
  let cursor = 0;

  while (cursor < totalDurationSec) {
    const idealEnd = cursor + sourceDurationPerPart;

    if (idealEnd >= totalDurationSec) {
      // Last part: take everything remaining
      cuts.push({
        startSec: cursor,
        endSec: totalDurationSec,
        partIndex: cuts.length,
      });
      break;
    }

    const cutAt = findBestCut(idealEnd, silences);

    cuts.push({
      startSec: cursor,
      endSec: cutAt,
      partIndex: cuts.length,
    });
    cursor = cutAt;
  }

  // Merge trailing segment if too short after speed-up
  if (cuts.length >= 2) {
    const last = cuts[cuts.length - 1]!;
    const lastOutputDuration =
      (last.endSec - last.startSec) / playbackSpeed;
    if (lastOutputDuration < MIN_TRAILING_SEC) {
      cuts.pop();
      cuts[cuts.length - 1]!.endSec = totalDurationSec;
    }
  }

  return cuts;
}

// Chapters shorter than (target * CHAPTER_TOLERANCE) stay as a single part
// instead of subdividing into a lopsided 2-way split. At the default 5-min
// target this tolerance (30 s) lines up with MIN_TRAILING_SEC so the inner
// planCuts would have merged the tail back in anyway.
const CHAPTER_TOLERANCE = 1.1;

/** Sort chapters chronologically and prepend a synthetic "Intro" if the
 *  first chapter starts > 1 s in, so leading audio isn't silently lost. */
function normalizeChapters(chapters: Chapter[]): Chapter[] {
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  if (sorted[0]!.start > 1) {
    sorted.unshift({ title: "Intro", start: 0 });
  }
  return sorted;
}

/**
 * Cheap O(chapters) predicate that mirrors the subdivision test inside
 * `planCutsFromChapters` without running the planner. Used by the worker
 * to decide whether silence detection is worth running in chapter mode:
 * if no chapter will subdivide, silences are never used.
 */
export function anyChapterWillSubdivide(
  chapters: Chapter[],
  totalDurationSec: number,
  targetPartSec: number,
  playbackSpeed: number,
): boolean {
  if (chapters.length === 0) return false;
  const sorted = normalizeChapters(chapters);
  const ceiling = targetPartSec * CHAPTER_TOLERANCE;
  for (let i = 0; i < sorted.length; i++) {
    const startSec = sorted[i]!.start;
    const endSec =
      i + 1 < sorted.length ? sorted[i + 1]!.start : totalDurationSec;
    if (endSec <= startSec) continue;
    if ((endSec - startSec) / playbackSpeed > ceiling) return true;
  }
  return false;
}

/**
 * Plans cuts directly from parsed MP3/M4B chapters. Guarantees ordered,
 * gap-free coverage from 0 to totalDurationSec:
 *
 *  1. Sorts by start — parsers don't guarantee chronological order.
 *  2. If the first chapter starts > 1 s in, prepends a synthetic "Intro"
 *     chapter from 0 so leading ads / cold-open audio isn't silently lost.
 *  3. Each chapter's endSec is derived from the next chapter's start (the
 *     last chapter runs to totalDurationSec). Parser-supplied `end` fields
 *     are intentionally ignored — they can leave gaps or overlap.
 *  4. Zero-length segments are dropped, so a chapter at the exact file end
 *     doesn't produce an empty part.
 *  5. Chapters whose output duration (accounting for playbackSpeed) exceeds
 *     targetPartSec * CHAPTER_TOLERANCE are subdivided: the shared silence
 *     list is filtered + rebased into the chapter's window and fed to
 *     planCuts, whose returned sub-cuts are offset back to absolute time.
 *     Sub-parts carry chapterPartIndex/chapterPartCount so downstream code
 *     can format them distinctly.
 *
 * All chapter-mode cuts carry chapterNumber + totalChapters (post-Intro-
 * prepend) so speech text and filenames refer to the true chapter ordinal
 * instead of the global partIndex.
 */
export function planCutsFromChapters(
  chapters: Chapter[],
  totalDurationSec: number,
  targetPartSec: number,
  playbackSpeed: number,
  silences: SilenceInterval[],
): CutPoint[] {
  if (chapters.length === 0) return [];
  const sorted = normalizeChapters(chapters);

  // Build [start, end] windows first so totalChapters can exclude any
  // zero-length segments dropped below (a trailing chapter at exact file
  // end, etc.).
  const windows: { title: string; start: number; end: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startSec = sorted[i]!.start;
    const endSec =
      i + 1 < sorted.length ? sorted[i + 1]!.start : totalDurationSec;
    if (endSec > startSec) {
      windows.push({ title: sorted[i]!.title, start: startSec, end: endSec });
    }
  }

  const totalChapters = windows.length;
  const cuts: CutPoint[] = [];
  const ceiling = targetPartSec * CHAPTER_TOLERANCE;

  for (let ci = 0; ci < windows.length; ci++) {
    const win = windows[ci]!;
    const chapterBase = {
      title: win.title,
      number: ci + 1,
      totalChapters,
    };
    const windowLen = win.end - win.start;
    const outputDuration = windowLen / playbackSpeed;

    if (outputDuration <= ceiling) {
      cuts.push({
        startSec: win.start,
        endSec: win.end,
        partIndex: 0, // patched in the final pass
        chapter: chapterBase,
      });
      continue;
    }

    // Filter whole-file silences into the chapter window and rebase to
    // zero-origin so planCuts (which assumes [0, N]) can snap to them
    // without reaching outside the window.
    const rebased: SilenceInterval[] = [];
    for (const s of silences) {
      if (s.end <= win.start || s.start >= win.end) continue;
      rebased.push({
        start: Math.max(0, s.start - win.start),
        end: Math.min(windowLen, s.end - win.start),
      });
    }

    const subCuts = planCuts(windowLen, targetPartSec, playbackSpeed, rebased);
    for (let si = 0; si < subCuts.length; si++) {
      const sub = subCuts[si]!;
      cuts.push({
        startSec: win.start + sub.startSec,
        endSec: win.start + sub.endSec,
        partIndex: 0, // patched in the final pass
        chapter: {
          ...chapterBase,
          part: { index: si + 1, count: subCuts.length },
        },
      });
    }
  }

  // Assign contiguous global partIndex in a final flat pass so the
  // parallel-encoding queue in the worker can rely on a gapless 0..N-1.
  for (let i = 0; i < cuts.length; i++) {
    cuts[i]!.partIndex = i;
  }
  return cuts;
}

function findBestCut(
  idealEnd: number,
  silences: SilenceInterval[],
): number {
  const windowStart = idealEnd - GRACE_WINDOW_SEC;
  const windowEnd = idealEnd + GRACE_WINDOW_SEC;

  const candidates = silences.filter(
    (s) => s.start >= windowStart && s.start <= windowEnd,
  );

  if (candidates.length === 0) {
    return idealEnd;
  }

  // Pick silence closest to ideal; tie-break by longer silence, then prefer earlier
  let best = candidates[0]!;
  let bestMid = (best.start + best.end) / 2;
  let bestDist = Math.abs(bestMid - idealEnd);
  let bestDur = best.end - best.start;

  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    const mid = (c.start + c.end) / 2;
    const dist = Math.abs(mid - idealEnd);
    const dur = c.end - c.start;

    if (
      dist < bestDist ||
      (dist === bestDist && dur > bestDur) ||
      (dist === bestDist && dur === bestDur && mid < bestMid)
    ) {
      best = c;
      bestMid = mid;
      bestDist = dist;
      bestDur = dur;
    }
  }

  return bestMid;
}
