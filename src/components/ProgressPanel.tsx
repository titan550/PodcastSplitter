import type { ProgressPayload, Phase } from "../types";

interface Props {
  progress: ProgressPayload | null;
  onCancel: () => void;
}

const PHASE_LABELS: Record<Phase, string> = {
  loading: "Loading engines",
  analyzing: "Analyzing audio",
  planning: "Planning segments",
  tts: "Generating speech",
  encoding: "Encoding audio",
  zipping: "Building ZIP",
};

export function ProgressPanel({ progress, onCancel }: Props) {
  if (!progress) {
    return (
      <div className="progress-panel">
        <p>Starting...</p>
      </div>
    );
  }

  return (
    <div className="progress-panel">
      <strong className="progress-panel__phase">
        {PHASE_LABELS[progress.phase]}
      </strong>

      {progress.detail && (
        <p className="progress-panel__detail">{progress.detail}</p>
      )}

      <div className="progress-bar">
        <div
          className="progress-bar__fill"
          style={{ width: `${Math.round(progress.overallPct)}%` }}
        />
      </div>
      <p className="progress-panel__pct">
        {Math.round(progress.overallPct)}% overall
      </p>

      <button className="btn btn--secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
