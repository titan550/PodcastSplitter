import type { ProcessingSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const SETTINGS_KEY = "podcast_splitter_settings";

const VALID_BITRATES = ["64k", "96k", "128k", "192k", "256k", "320k"];
const VALID_AUDIO_PROFILES = ["source", "voice"];

/** Per-field validator: returns true when the value is within the allowed
 *  domain, not just type-compatible. Drops corrupt/out-of-range values so
 *  the DEFAULT_SETTINGS spread fills them in instead. */
function isValidValue(key: keyof ProcessingSettings, value: unknown): boolean {
  switch (key) {
    case "targetPartCount":
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120;
    case "podcastTitle":
      return typeof value === "string";
    case "playbackSpeed":
      return typeof value === "number" && value >= 1.0 && value <= 2.0;
    case "spokenAnnouncements":
    case "skipLongSilences":
      return typeof value === "boolean";
    case "outputBitrate":
      return typeof value === "string" && VALID_BITRATES.includes(value);
    case "voiceId":
      return typeof value === "string" && value.length > 0;
    case "silenceThresholdDb":
      return typeof value === "number" && value >= -50 && value <= -10;
    case "silenceRemovalThresholdDb":
      return typeof value === "number" && value >= -60 && value <= -20;
    case "silenceMinDurationSec":
      return typeof value === "number" && value >= 0.1 && value <= 2.0;
    case "parallelEncoding":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
    case "skipLongSilenceMinSec":
      return typeof value === "number" && value >= 1 && value <= 10;
    case "audioProfile":
      return typeof value === "string" && VALID_AUDIO_PROFILES.includes(value);
    case "subdivideLongChapters":
      return typeof value === "boolean";
    case "maxChapterPartMin":
      return typeof value === "number" && Number.isInteger(value) && value >= 5 && value <= 60;
    default: {
      // Compile-time exhaustiveness check: if a new field is added to
      // ProcessingSettings but not handled above, this line errors.
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function loadSettings(): Partial<ProcessingSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return {};
    const obj = parsed as Record<string, unknown>;

    // One-time rename migration: preserve explicit `spokenPrefix: false`
    // so users who had announcements disabled keep them disabled. The key
    // is removed so it never reappears in saved state.
    if (typeof obj.spokenPrefix === "boolean" && obj.spokenAnnouncements === undefined) {
      obj.spokenAnnouncements = obj.spokenPrefix;
    }
    delete obj.spokenPrefix;

    // Drop legacy `targetPartDurationSec` so it doesn't leak past load.
    // Its value is recovered via loadLegacyTargetPartDurationSec() and
    // converted to targetPartCount once the first file's duration is
    // known (see useJobReducer FILE_SELECTED handler).
    delete obj.targetPartDurationSec;

    const out: Record<string, unknown> = {};
    const keys = Object.keys(DEFAULT_SETTINGS) as (keyof ProcessingSettings)[];
    for (const key of keys) {
      if (key in obj && isValidValue(key, obj[key])) {
        out[key] = obj[key];
      }
    }
    return out as Partial<ProcessingSettings>;
  } catch {
    return {};
  }
}

/**
 * Pre-rename migration shim: returns the saved `targetPartDurationSec` if
 * present and valid, so the reducer can convert it to an equivalent
 * `targetPartCount` once the first file's duration is known. Returns null
 * for new users or any invalid/missing value.
 */
export function loadLegacyTargetPartDurationSec(): number | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    const v = (parsed as Record<string, unknown>).targetPartDurationSec;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v < 120 || v > 900) return null;
    return v;
  } catch {
    return null;
  }
}

export function saveSettings(settings: ProcessingSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded — ignore
  }
}
