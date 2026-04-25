import type { ErrorPayload } from "../types";

interface Props {
  error: ErrorPayload;
  // Optional so mandatory errors (e.g. chime-load) can omit Dismiss and
  // leave only Retry as the path forward. At least one of {onRetry, onDismiss}
  // must be passed so the user isn't stuck.
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ error, onDismiss, onRetry }: Props) {
  return (
    <div role="alert" className="error-banner">
      <p>
        <strong>Error during {error.phase}:</strong> {error.message}
      </p>
      {onRetry && (
        <button className="btn btn--primary" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button className="btn btn--secondary" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
