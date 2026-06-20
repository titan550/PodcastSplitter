import type {
  Chapter,
  CutPoint,
  ProcessingSettings,
  SilenceInterval,
  SplitMode,
} from "../types";
import { clampPartCount } from "./partCount";

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

/**
 * Plan exactly `partCount` cuts covering `totalDurationSec`. Each boundary
 * is allowed to snap to a nearby silence within a grace window capped at
 * 30% of the per-segment duration so consecutive cuts cannot cross.
 *
 * Unlike planCuts, this does NOT merge a short trailing segment — the
 * count is the contract. Callers (UI + worker) clamp partCount against
 * a 5-minute floor so trailing segments stay audible.
 */
export function planCutsByCount(
  totalDurationSec: number,
  partCount: number,
  silences: SilenceInterval[],
): CutPoint[] {
  if (partCount <= 1) {
    return [{ startSec: 0, endSec: totalDurationSec, partIndex: 0 }];
  }
  const segLen = totalDurationSec / partCount;
  // Cap grace at 30% of segment length so cut[i] and cut[i+1] can't cross.
  const graceWindow = Math.min(GRACE_WINDOW_SEC, segLen * 0.3);

  const cuts: CutPoint[] = [];
  let cursor = 0;
  for (let i = 1; i < partCount; i++) {
    const ideal = i * segLen;
    const cutAt = findBestCut(ideal, silences, graceWindow);
    cuts.push({ startSec: cursor, endSec: cutAt, partIndex: cuts.length });
    cursor = cutAt;
  }
  cuts.push({ startSec: cursor, endSec: totalDurationSec, partIndex: cuts.length });
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

interface ChapterWindow {
  title: string;
  start: number;
  end: number;
}

/** Build gap-free [start, end] windows from chapters: ends derive from the
 *  next chapter's start (last → file end). Parser-supplied `end` fields are
 *  ignored (they can gap/overlap) and zero-length windows are dropped. */
function chapterWindows(
  chapters: Chapter[],
  totalDurationSec: number,
): ChapterWindow[] {
  const sorted = normalizeChapters(chapters);
  const windows: ChapterWindow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!.start;
    const end = i + 1 < sorted.length ? sorted[i + 1]!.start : totalDurationSec;
    if (end > start) windows.push({ title: sorted[i]!.title, start, end });
  }
  return windows;
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
  subdivide: boolean = true,
): boolean {
  if (!subdivide || chapters.length === 0) return false;
  const ceiling = targetPartSec * CHAPTER_TOLERANCE;
  return chapterWindows(chapters, totalDurationSec).some(
    (w) => (w.end - w.start) / playbackSpeed > ceiling,
  );
}

/**
 * Plan cuts directly from parsed chapters, with ordered gap-free coverage
 * of [0, totalDurationSec] (boundary rules live in chapterWindows).
 * Chapters whose output duration exceeds targetPartSec * CHAPTER_TOLERANCE
 * are subdivided via planCuts — the shared silence list is filtered and
 * rebased into the chapter window, then sub-cuts are offset back to
 * absolute time and tagged with part.index/count. Every cut carries the
 * chapter number + totalChapters (post-Intro-prepend) so speech text and
 * filenames use the true chapter ordinal, not the global partIndex.
 */
export function planCutsFromChapters(
  chapters: Chapter[],
  totalDurationSec: number,
  targetPartSec: number,
  playbackSpeed: number,
  silences: SilenceInterval[],
  subdivide: boolean = true,
): CutPoint[] {
  if (chapters.length === 0) return [];
  const windows = chapterWindows(chapters, totalDurationSec);

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

    if (!subdivide || outputDuration <= ceiling) {
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

/**
 * Best cut point near `idealEnd`: intersect candidate silences with the
 * grace window and score their midpoints. The result is always within
 * `[idealEnd - graceSec, idealEnd + graceSec]` — the exact-count planner's
 * monotonicity depends on cuts not escaping their segment's window.
 */
export function findBestCut(
  idealEnd: number,
  silences: SilenceInterval[],
  graceSec: number = GRACE_WINDOW_SEC,
): number {
  const windowStart = idealEnd - graceSec;
  const windowEnd = idealEnd + graceSec;

  let bestMid = idealEnd;
  let bestDist = Infinity;
  let bestDur = -Infinity;

  for (const s of silences) {
    if (s.end <= windowStart || s.start >= windowEnd) continue; // any overlap
    const segStart = Math.max(s.start, windowStart);
    const segEnd = Math.min(s.end, windowEnd);
    const dur = segEnd - segStart;
    if (dur <= 0) continue;
    const mid = (segStart + segEnd) / 2;
    const dist = Math.abs(mid - idealEnd);

    if (
      dist < bestDist ||
      (dist === bestDist && dur > bestDur) ||
      (dist === bestDist && dur === bestDur && mid < bestMid)
    ) {
      bestMid = mid;
      bestDist = dist;
      bestDur = dur;
    }
  }

  return bestMid;
}

/**
 * Estimate the output part count for the given settings, matching what the
 * worker will produce. Time mode is exactly the clamped part count; chapter
 * mode dry-runs the planner so the estimate reflects subdivision. Keeps the
 * UI estimate from re-deriving the worker's planning inputs by hand.
 */
export function estimatePartCount(
  splitMode: SplitMode,
  chapters: Chapter[],
  durationSec: number,
  settings: Pick<
    ProcessingSettings,
    | "targetPartCount"
    | "playbackSpeed"
    | "maxChapterPartMin"
    | "subdivideLongChapters"
  >,
): number {
  if (splitMode !== "chapters" || chapters.length < 2) {
    return clampPartCount(
      settings.targetPartCount,
      durationSec,
      settings.playbackSpeed,
    );
  }
  return planCutsFromChapters(
    chapters,
    durationSec,
    settings.maxChapterPartMin * 60,
    settings.playbackSpeed,
    [],
    settings.subdivideLongChapters,
  ).length;
}
