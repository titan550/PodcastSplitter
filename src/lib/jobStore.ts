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
    case "targetPartDurationSec":
      return typeof value === "number" && value >= 120 && value <= 900;
    case "podcastTitle":
      return typeof value === "string";
    case "playbackSpeed":
      return typeof value === "number" && value >= 1.0 && value <= 2.0;
    case "spokenPrefix":
    case "skipLongSilences":
      return typeof value === "boolean";
    case "outputBitrate":
      return typeof value === "string" && VALID_BITRATES.includes(value);
    case "voiceId":
      return typeof value === "string" && value.length > 0;
    case "silenceThresholdDb":
      return typeof value === "number" && value >= -50 && value <= -10;
    case "silenceMinDurationSec":
      return typeof value === "number" && value >= 0.1 && value <= 2.0;
    case "parallelEncoding":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4;
    case "skipLongSilenceMinSec":
      return typeof value === "number" && value >= 1 && value <= 10;
    case "audioProfile":
      return typeof value === "string" && VALID_AUDIO_PROFILES.includes(value);
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

export function saveSettings(settings: ProcessingSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // quota exceeded — ignore
  }
}
