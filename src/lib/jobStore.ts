import type { ProcessingSettings } from "../types";

const SETTINGS_KEY = "podcast_splitter_settings";

export function loadSettings(): Partial<ProcessingSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
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
