import { useState } from "react";
import type { ProcessingSettings, RuntimeCapabilities } from "../types";
import { clearAllCaches, estimateFirstRunDownloads } from "../lib/cache/modelCache";

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
      await clearAllCaches();
      alert("Caches cleared.");
    } catch {
      alert("Failed to clear caches.");
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

  const downloads = estimateFirstRunDownloads();

  return (
    <details open className="advanced-settings">
      <summary onClick={() => setOpen(false)}>Advanced settings</summary>

      <label className="settings-form__field">
        <span>Output bitrate</span>
        <select
          value={settings.outputBitrate}
          onChange={(e) => onChange({ outputBitrate: e.target.value })}
        >
          <option value="64k">64k (speech-optimized)</option>
          <option value="96k">96k</option>
          <option value="128k">128k (default)</option>
          <option value="192k">192k</option>
        </select>
      </label>

      <label className="settings-form__field">
        <span>
          Silence threshold: {settings.silenceThresholdDb} dB
        </span>
        <input
          type="range"
          min={-50}
          max={-10}
          step={1}
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
          min={0.1}
          max={2.0}
          step={0.1}
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

      <label className="settings-form__field settings-form__toggle">
        <input
          type="checkbox"
          checked={settings.preferMultiThread}
          disabled={!capabilities?.multiThreadAvailable}
          onChange={(e) =>
            onChange({ preferMultiThread: e.target.checked })
          }
        />
        <span>
          Multi-thread ffmpeg
          {!capabilities?.multiThreadAvailable && " (not available)"}
        </span>
      </label>

      <div className="advanced-settings__downloads">
        <p>First-run downloads:</p>
        <ul>
          {downloads.map((d) => (
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
