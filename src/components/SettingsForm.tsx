import type { ProcessingSettings, RuntimeCapabilities } from "../types";
import { AdvancedSettings } from "./AdvancedSettings";

interface Props {
  settings: ProcessingSettings;
  durationSec: number;
  fileSizeMB: number;
  capabilities: RuntimeCapabilities | null;
  onChange: (partial: Partial<ProcessingSettings>) => void;
  onStart: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SettingsForm({
  settings,
  durationSec,
  fileSizeMB,
  capabilities,
  onChange,
  onStart,
}: Props) {
  const estimatedParts = Math.max(
    1,
    Math.ceil(
      durationSec /
        settings.playbackSpeed /
        settings.targetPartDurationSec *
        settings.playbackSpeed,
    ),
  );

  return (
    <div className="settings-form">
      <div className="settings-form__info">
        <span>Duration: {formatDuration(durationSec)}</span>
        <span>Size: {fileSizeMB.toFixed(1)} MB</span>
        <span>~{estimatedParts} parts</span>
      </div>

      <label className="settings-form__field">
        <span>Podcast Title</span>
        <input
          type="text"
          value={settings.podcastTitle}
          onChange={(e) => onChange({ podcastTitle: e.target.value })}
        />
      </label>

      <label className="settings-form__field">
        <span>Minutes per part: {settings.targetPartDurationSec / 60}</span>
        <input
          type="range"
          min={2}
          max={15}
          step={1}
          value={settings.targetPartDurationSec / 60}
          onChange={(e) =>
            onChange({ targetPartDurationSec: Number(e.target.value) * 60 })
          }
        />
      </label>

      <label className="settings-form__field">
        <span>Playback speed: {settings.playbackSpeed.toFixed(2)}x</span>
        <input
          type="range"
          min={1.0}
          max={2.0}
          step={0.05}
          value={settings.playbackSpeed}
          onChange={(e) =>
            onChange({ playbackSpeed: Number(e.target.value) })
          }
        />
      </label>

      <label className="settings-form__field settings-form__toggle">
        <input
          type="checkbox"
          checked={settings.spokenPrefix}
          onChange={(e) => onChange({ spokenPrefix: e.target.checked })}
        />
        <span>Spoken prefix ("Part N of Title")</span>
      </label>

      <AdvancedSettings
        settings={settings}
        capabilities={capabilities}
        onChange={onChange}
      />

      <button
        className="btn btn--primary"
        onClick={onStart}
        disabled={!settings.podcastTitle.trim()}
      >
        Start Processing
      </button>
    </div>
  );
}
