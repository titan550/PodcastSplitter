import type { ProcessingSettings } from "../types";
import { DEFAULT_SETTINGS, SETTINGS_BOUNDS } from "../types";
import { MAX_PART_COUNT } from "./partCount";

const SETTINGS_KEY = "podcast_splitter_settings";

const VALID_BITRATES = ["64k", "96k", "128k", "192k", "256k", "320k"];
const VALID_AUDIO_PROFILES = ["source", "voice"];

function inBounds(v: unknown, b: { min: number; max: number }): boolean {
  return typeof v === "number" && v >= b.min && v <= b.max;
}

/** Per-field validator: returns true when the value is within the allowed
 *  domain, not just type-compatible. Drops corrupt/out-of-range values so
 *  the DEFAULT_SETTINGS spread fills them in instead. */
function isValidValue(key: keyof ProcessingSettings, value: unknown): boolean {
  switch (key) {
    case "targetPartCount":
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PART_COUNT;
    case "podcastTitle":
      return typeof value === "string";
    case "playbackSpeed":
      return inBounds(value, SETTINGS_BOUNDS.playbackSpeed);
    case "spokenAnnouncements":
    case "skipLongSilences":
      return typeof value === "boolean";
    case "outputBitrate":
      return typeof value === "string" && VALID_BITRATES.includes(value);
    case "voiceId":
      return typeof value === "string" && value.length > 0;
    case "silenceThresholdDb":
      return inBounds(value, SETTINGS_BOUNDS.silenceThresholdDb);
    case "silenceRemovalThresholdDb":
      return inBounds(value, SETTINGS_BOUNDS.silenceRemovalThresholdDb);
    case "silenceMinDurationSec":
      return inBounds(value, SETTINGS_BOUNDS.silenceMinDurationSec);
    case "parallelEncoding":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
    case "skipLongSilenceMinSec":
      return inBounds(value, SETTINGS_BOUNDS.skipLongSilenceMinSec);
    case "audioProfile":
      return typeof value === "string" && VALID_AUDIO_PROFILES.includes(value);
    case "subdivideLongChapters":
      return typeof value === "boolean";
    case "maxChapterPartMin":
      return Number.isInteger(value) && inBounds(value, SETTINGS_BOUNDS.maxChapterPartMin);
    default: {
      // Compile-time exhaustiveness check: if a new field is added to
      // ProcessingSettings but not handled above, this line errors.
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export interface StoredSettings {
  settings: Partial<ProcessingSettings>;
  // Pre-rename `targetPartDurationSec` (seconds), recovered so the reducer
  // can convert it to a targetPartCount once the first file's duration is
  // known. Null for new users or any invalid value.
  legacyTargetPartDurationSec: number | null;
}

const EMPTY: StoredSettings = { settings: {}, legacyTargetPartDurationSec: null };

/** Read and validate persisted settings in a single parse of localStorage. */
export function loadStoredSettings(): StoredSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return EMPTY;
    const obj = parsed as Record<string, unknown>;

    // Recover the legacy duration-based setting before it's stripped below.
    const rawLegacy = obj.targetPartDurationSec;
    const legacyTargetPartDurationSec =
      typeof rawLegacy === "number" &&
      Number.isFinite(rawLegacy) &&
      rawLegacy >= 120 &&
      rawLegacy <= 900
        ? rawLegacy
        : null;

    // One-time rename: preserve explicit `spokenPrefix: false` so users who
    // disabled announcements keep them disabled. Strip both legacy keys so
    // they never reappear in saved state.
    if (typeof obj.spokenPrefix === "boolean" && obj.spokenAnnouncements === undefined) {
      obj.spokenAnnouncements = obj.spokenPrefix;
    }
    delete obj.spokenPrefix;
    delete obj.targetPartDurationSec;

    const out: Record<string, unknown> = {};
    const keys = Object.keys(DEFAULT_SETTINGS) as (keyof ProcessingSettings)[];
    for (const key of keys) {
      if (key in obj && isValidValue(key, obj[key])) out[key] = obj[key];
    }
    return {
      settings: out as Partial<ProcessingSettings>,
      legacyTargetPartDurationSec,
    };
  } catch {
    return EMPTY;
  }
}

export function saveSettings(settings: ProcessingSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded — ignore
  }
}
