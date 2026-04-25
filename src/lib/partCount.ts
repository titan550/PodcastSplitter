// Cap on saved targetPartCount regardless of duration; matches the
// jobStore validator's upper bound. Listening floor keeps each part
// audible after playback speed-up.
const MAX_PART_COUNT = 120;
const MIN_LISTENING_SEC_PER_PART = 300;

/**
 * Maximum part count allowed for a file at the given playback speed.
 * Single source of truth used by the slider's max attribute, the
 * pre-postMessage clamp in handleStart, the worker's payload validation,
 * and the legacy-settings migration.
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
