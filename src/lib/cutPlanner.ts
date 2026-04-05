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
 *
 * Returned cuts share the same CutPoint shape as time-based cuts so the
 * downstream encoding pipeline treats both modes uniformly.
 */
export function planCutsFromChapters(
  chapters: Chapter[],
  totalDurationSec: number,
): CutPoint[] {
  if (chapters.length === 0) return [];
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  if (sorted[0]!.start > 1) {
    sorted.unshift({ title: "Intro", start: 0 });
  }
  const cuts: CutPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const startSec = sorted[i]!.start;
    const endSec =
      i + 1 < sorted.length ? sorted[i + 1]!.start : totalDurationSec;
    if (endSec > startSec) {
      cuts.push({
        startSec,
        endSec,
        partIndex: cuts.length,
        chapterTitle: sorted[i]!.title,
      });
    }
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
