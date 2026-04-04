import type { CutPoint, SilenceInterval } from "../types";

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
