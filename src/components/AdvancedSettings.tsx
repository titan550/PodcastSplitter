import { useState } from "react";
import type { ProcessingSettings, RuntimeCapabilities } from "../types";
import { SETTINGS_BOUNDS } from "../types";
import { clearAllCaches, FIRST_RUN_DOWNLOADS } from "../lib/cache/modelCache";

interface Props {
  settings: ProcessingSettings;
  capabilities: RuntimeCapabilities | null;
  onChange: (partial: Partial<ProcessingSettings>) => void;
}

export function AdvancedSettings({ settings, capabilities, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const result = await clearAllCaches();
      const ok =
        result.blobCache === "cleared" && result.voiceModel === "cleared";
      alert(
        ok
          ? "Cleared the voice model and audio cache. (The FFmpeg and ONNX runtime files stay in the browser's HTTP cache — clear site data to remove those.)"
          : "Some caches could not be cleared.",
      );
    } finally {
      setClearing(false);
    }
  };

  if (!open) {
    return (
      <button
        className="btn btn--link"
        type="button"
        onClick={() => setOpen(true)}
      >
        Advanced settings
      </button>
    );
  }

  return (
    <details open className="advanced-settings">
      <summary onClick={() => setOpen(false)}>Advanced settings</summary>

      <div className="settings-form__field">
        <span>Audio quality</span>
        <div className="split-mode-toggle">
          <button
            type="button"
            className={`split-mode-toggle__btn ${
              settings.audioProfile === "source"
                ? "split-mode-toggle__btn--active"
                : ""
            }`}
            onClick={() => onChange({ audioProfile: "source" })}
          >
            Source
          </button>
          <button
            type="button"
            className={`split-mode-toggle__btn ${
              settings.audioProfile === "voice"
                ? "split-mode-toggle__btn--active"
                : ""
            }`}
            onClick={() => onChange({ audioProfile: "voice" })}
          >
            Voice
          </button>
        </div>
        <small className="settings-form__hint">
          {settings.audioProfile === "source"
            ? "Preserve the original sample rate and channels."
            : "Downmix to 22 kHz mono. Smallest files, optimized for sports headphones."}
        </small>
      </div>

      <label className="settings-form__field">
        <span>Output bitrate</span>
        <select
          value={settings.outputBitrate}
          onChange={(e) => onChange({ outputBitrate: e.target.value })}
        >
          <option value="64k">64k</option>
          <option value="96k">96k</option>
          <option value="128k">128k (default)</option>
          <option value="192k">192k</option>
          <option value="256k">256k</option>
          <option value="320k">320k</option>
        </select>
      </label>

      <label className="settings-form__field">
        <span>
          Silence threshold: {settings.silenceThresholdDb} dB
        </span>
        <input
          type="range"
          {...SETTINGS_BOUNDS.silenceThresholdDb}
          value={settings.silenceThresholdDb}
          onChange={(e) =>
            onChange({ silenceThresholdDb: Number(e.target.value) })
          }
        />
      </label>

      <label className="settings-form__field">
        <span>
          Min silence duration: {settings.silenceMinDurationSec.toFixed(1)}s
        </span>
        <input
          type="range"
          {...SETTINGS_BOUNDS.silenceMinDurationSec}
          value={settings.silenceMinDurationSec}
          onChange={(e) =>
            onChange({ silenceMinDurationSec: Number(e.target.value) })
          }
        />
      </label>

      <label className="settings-form__field">
        <span>
          Parallel encoding
          {capabilities?.isMobile && " (1 recommended on mobile)"}
        </span>
        <select
          value={settings.parallelEncoding}
          onChange={(e) =>
            onChange({ parallelEncoding: Number(e.target.value) })
          }
        >
          <option value={0}>Auto (recommended)</option>
          <option value={1}>1 instance (safest, least memory)</option>
          <option value={2}>2 instances (~2× memory)</option>
          <option value={3}>3 instances (~3× memory)</option>
          <option value={4}>4 instances (~4× memory)</option>
        </select>
      </label>

      <div className="advanced-settings__downloads">
        <p>First-run downloads:</p>
        <ul>
          {FIRST_RUN_DOWNLOADS.map((d) => (
            <li key={d.label}>
              {d.label}: ~{d.sizeMB} MB
            </li>
          ))}
        </ul>
      </div>

      <button
        className="btn btn--secondary"
        type="button"
        onClick={handleClearCache}
        disabled={clearing}
      >
        {clearing ? "Clearing..." : "Clear cached models"}
      </button>
    </details>
  );
}
