import { useMemo } from "react";
import type {
  Chapter,
  ProcessingSettings,
  RuntimeCapabilities,
  SplitMode,
} from "../types";
import { planCutsFromChapters } from "../lib/cutPlanner";
import { AdvancedSettings } from "./AdvancedSettings";

interface Props {
  settings: ProcessingSettings;
  durationSec: number;
  fileSizeMB: number;
  capabilities: RuntimeCapabilities | null;
  chapters: Chapter[];
  splitMode: SplitMode;
  onChange: (partial: Partial<ProcessingSettings>) => void;
  onSplitModeChange: (mode: SplitMode) => void;
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
  chapters,
  splitMode,
  onChange,
  onSplitModeChange,
  onStart,
}: Props) {
  const hasChapters = chapters.length >= 2;
  const useChapterMode = hasChapters && splitMode === "chapters";

  // Dry-run the planner for chapter mode so the estimate reflects
  // subdivision (long chapters split by the target ceiling). Memoized
  // because a 100+ chapter audiobook would otherwise re-sort + re-plan
  // on every slider-drag render.
  const estimatedParts = useMemo(() => {
    if (useChapterMode) {
      return planCutsFromChapters(
        chapters,
        durationSec,
        settings.targetPartDurationSec,
        settings.playbackSpeed,
        [],
      ).length;
    }
    return Math.max(1, Math.ceil(durationSec / settings.targetPartDurationSec));
  }, [
    useChapterMode,
    chapters,
    durationSec,
    settings.targetPartDurationSec,
    settings.playbackSpeed,
  ]);

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

      {hasChapters && (
        <div className="settings-form__field">
          <span>Split by</span>
          <div className="split-mode-toggle">
            <button
              type="button"
              className={`split-mode-toggle__btn ${
                splitMode === "chapters" ? "split-mode-toggle__btn--active" : ""
              }`}
              onClick={() => onSplitModeChange("chapters")}
            >
              Chapters ({chapters.length})
            </button>
            <button
              type="button"
              className={`split-mode-toggle__btn ${
                splitMode === "time" ? "split-mode-toggle__btn--active" : ""
              }`}
              onClick={() => onSplitModeChange("time")}
            >
              Time
            </button>
          </div>
          {useChapterMode && (
            <details className="chapter-list" open>
              <summary>Chapters</summary>
              <ul className="chapter-list__items">
                {chapters.map((c, i) => (
                  <li key={`${i}-${c.start}`}>
                    <span className="chapter-list__num">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="chapter-list__title">
                      {c.title || `Chapter ${i + 1}`}
                    </span>
                    <span className="chapter-list__time">
                      {formatDuration(c.start)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <label className="settings-form__field">
        <span>
          {useChapterMode ? "Max minutes per part" : "Minutes per part"}:{" "}
          {settings.targetPartDurationSec / 60}
        </span>
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
        {useChapterMode && (
          <small className="settings-form__hint">
            Long chapters are split at silence points to stay under this.
          </small>
        )}
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
        <span>Spoken prefix before each part</span>
      </label>

      <label className="settings-form__field settings-form__toggle">
        <input
          type="checkbox"
          checked={settings.skipLongSilences}
          onChange={(e) => onChange({ skipLongSilences: e.target.checked })}
        />
        <span>Skip long silences</span>
      </label>

      {settings.skipLongSilences && (
        <label className="settings-form__field">
          <span>
            Cut silences longer than: {settings.skipLongSilenceMinSec.toFixed(1)}s
          </span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={settings.skipLongSilenceMinSec}
            onChange={(e) =>
              onChange({ skipLongSilenceMinSec: Number(e.target.value) })
            }
          />
        </label>
      )}

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
