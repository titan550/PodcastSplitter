import type { ErrorPayload } from "../types";

interface Props {
  error: ErrorPayload;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  return (
    <div role="alert" className="error-banner">
      <p>
        <strong>Error during {error.phase}:</strong> {error.message}
      </p>
      <button className="btn btn--secondary" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
