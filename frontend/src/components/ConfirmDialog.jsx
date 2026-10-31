import React, { useEffect, useRef } from 'react';

// Reusable destructive/sensitive-action confirmation dialog. Uses the site
// .dlg styles (colors, type, spacing, radii, buttons). Focus moves to the
// safe action first and is restored to the invoker on close; Esc and
// scrim-click cancel; the confirm button disables while busy so a double
// click cannot submit twice.
export default function ConfirmDialog({
  title,
  body,
  detail,
  confirmLabel,
  safeLabel = 'Cancel',
  busy = false,
  busyLabel,
  error = '',
  onConfirm,
  onClose,
}) {
  const safeRef = useRef(null);
  const invokerRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    invokerRef.current = document.activeElement;
    safeRef.current?.focus();
    return () => {
      if (invokerRef.current && typeof invokerRef.current.focus === 'function') {
        invokerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const root = dialogRef.current;
        if (!root) return;
        const focusable = root.querySelectorAll('button:not([disabled])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dlg-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="dlg" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <h2 id="confirm-dialog-title">{title}</h2>
        {body && <p className="dlg-sub">{body}</p>}
        {detail && <p className="m-delete-title">{detail}</p>}
        {error && (
          <p className="w-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-dialog-actions">
          <button type="button" className="m-danger" disabled={busy} onClick={onConfirm}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
          <button ref={safeRef} type="button" className="w-outline" disabled={busy} onClick={onClose}>
            {safeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
