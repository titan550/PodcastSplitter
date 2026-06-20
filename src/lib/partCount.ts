// Cap on saved targetPartCount regardless of duration. The listening floor
// keeps each part audible after playback speed-up.
export const MAX_PART_COUNT = 120;
const MIN_LISTENING_SEC_PER_PART = 300;

/**
 * Maximum part count allowed for a file at the given playback speed.
 * Single source of truth for the slider max, the handleStart clamp, the
 * worker's payload validation, and the legacy-settings migration.
 */
export function maxPartCount(
  durationSec: number,
  playbackSpeed: number,
): number {
  const listening = durationSec / playbackSpeed;
  return Math.min(
    MAX_PART_COUNT,
    Math.max(1, Math.floor(listening / MIN_LISTENING_SEC_PER_PART)),
  );
}

/** Clamp a requested part count into [1, maxPartCount] for this file. */
export function clampPartCount(
  count: number,
  durationSec: number,
  playbackSpeed: number,
): number {
  return Math.min(Math.max(1, count), maxPartCount(durationSec, playbackSpeed));
}
