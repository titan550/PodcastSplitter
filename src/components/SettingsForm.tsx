import { useMemo } from "react";
import type {
  Chapter,
  ProcessingSettings,
  RuntimeCapabilities,
  SplitMode,
} from "../types";
import { planCutsFromChapters } from "../lib/cutPlanner";
import { maxPartCount } from "../lib/partCount";
import { AdvancedSettings } from "./AdvancedSettings";

interface Props {
  settings: ProcessingSettings;
  durationSec: number;
  fileSizeMB: number;
  capabilities: RuntimeCapabilities | null;
  chapters: Chapter[];
  splitMode: SplitMode;
  chimesReady: boolean;
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
  chimesReady,
  onChange,
  onSplitModeChange,
  onStart,
}: Props) {
  const hasChapters = chapters.length >= 2;
  const useChapterMode = hasChapters && splitMode === "chapters";

  // Slider's max is recomputed every render from listening time so
  // changing playback speed shrinks/grows the range immediately. We
  // intentionally don't push the clamped `parts` back into settings —
  // handleStart and the worker re-clamp at the boundary, and keeping the
  // saved targetPartCount untouched preserves the user's preference for
  // future files where a higher count is still valid.
  const listeningDurationSec = durationSec / settings.playbackSpeed;
  const maxParts = maxPartCount(durationSec, settings.playbackSpeed);
  const parts = Math.min(Math.max(1, settings.targetPartCount), maxParts);

  const minutesEach = (listeningDurationSec / parts / 60).toFixed(1);

  // Dry-run the planner for chapter mode so the estimate reflects
  // subdivision (long chapters split by the target ceiling). Memoized
  // because a 100+ chapter audiobook would otherwise re-sort + re-plan
  // on every slider-drag render.
  //
  // The targetSec passed here MUST match what audioWorker.ts passes to
  // planCutsFromChapters — both compute `settings.maxChapterPartMin * 60`
  // literally so the UI estimate stays in sync with actual output.
  const estimatedParts = useMemo(() => {
    if (!useChapterMode) return parts; // planCutsByCount guarantees exactly this many
    return planCutsFromChapters(
      chapters,
      durationSec,
      settings.maxChapterPartMin * 60,
      settings.playbackSpeed,
      [],
      settings.subdivideLongChapters,
    ).length;
  }, [
    useChapterMode,
    chapters,
    durationSec,
    parts,
    settings.maxChapterPartMin,
    settings.playbackSpeed,
    settings.subdivideLongChapters,
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

      {useChapterMode ? (
        <>
          <label className="settings-form__field settings-form__toggle">
            <input
              type="checkbox"
              checked={settings.subdivideLongChapters}
              onChange={(e) =>
                onChange({ subdivideLongChapters: e.target.checked })
              }
            />
            <span>Subdivide long chapters into smaller parts</span>
          </label>
          {settings.subdivideLongChapters && (
            <label className="settings-form__field">
              <span>Target part length: {settings.maxChapterPartMin} min</span>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={settings.maxChapterPartMin}
                onChange={(e) =>
                  onChange({ maxChapterPartMin: Number(e.target.value) })
                }
              />
              <small className="settings-form__hint">
                Chapters longer than about this split into sub-parts of about this length. Shorter chapters stay as one part.
              </small>
            </label>
          )}
        </>
      ) : (
        <label className="settings-form__field">
          <span>
            Number of parts: {parts} (~{minutesEach} min of content each)
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(1, maxParts)}
            step={1}
            value={parts}
            onChange={(e) =>
              onChange({ targetPartCount: Number(e.target.value) })
            }
          />
          <small className="settings-form__hint">
            Final files are slightly longer than shown due to chimes and announcements.
          </small>
        </label>
      )}

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
          checked={settings.spokenAnnouncements}
          onChange={(e) => onChange({ spokenAnnouncements: e.target.checked })}
        />
        <span>Spoken announcements at the start and end of each part</span>
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
        <>
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
          <label className="settings-form__field">
            <span>
              Silence detection threshold: {settings.silenceRemovalThresholdDb} dB
            </span>
            <input
              type="range"
              min={-60}
              max={-20}
              step={1}
              value={settings.silenceRemovalThresholdDb}
              onChange={(e) =>
                onChange({
                  silenceRemovalThresholdDb: Number(e.target.value),
                })
              }
            />
            <small className="settings-form__hint">
              Only cut audio below this level. Lower (more negative) = stricter; less likely to clip quiet speech.
            </small>
          </label>
        </>
      )}

      <AdvancedSettings
        settings={settings}
        capabilities={capabilities}
        onChange={onChange}
      />

      <button
        className="btn btn--primary"
        onClick={onStart}
        disabled={!settings.podcastTitle.trim() || !chimesReady}
        title={!chimesReady ? "Loading audio assets…" : undefined}
      >
        Start Processing
      </button>
    </div>
  );
}
