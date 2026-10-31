import React from 'react';

// Shared inline field error: highlight comes from the input's aria-invalid
// state plus this message (never color-only). Focus management stays with
// the calling form (focus first invalid on submit).
export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p className="signin-inline-error" id={id} role="alert">
      {message}
    </p>
  );
}

// Shared inline banner for recoverable failures: keeps server detail,
// preserves form data/drafts, and never leaks raw exceptions. Render only
// after the server responds (no success before confirmation).
export function FormBanner({ message, variant }) {
  if (!message) return null;
  if (variant === 'success') {
    return (
      <p className="signin-alert signin-alert-success" role="status">
        {message}
      </p>
    );
  }
  return (
    <p className="signin-alert" role="alert">
      {message}
    </p>
  );
}

// Retry is only safe for idempotent reads or unsubmitted work; callers pass
// onRetry solely in those cases.
export function RetryButton({ onRetry, busy, label = 'Retry' }) {
  if (!onRetry) return null;
  return (
    <button type="button" className="w-outline" disabled={busy} onClick={onRetry}>
      {busy ? 'Retrying…' : label}
    </button>
  );
}
