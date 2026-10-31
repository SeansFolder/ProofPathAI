import React, { useEffect, useRef, useState } from 'react';
import { api, formatLongDate } from '../api.js';

function statusClass(status) {
  if (status === 'Submitted') return 'is-submitted';
  if (status === 'Resolved') return 'is-resolved';
  return 'is-draft';
}

export default function StatusDialog({ report, onClose, onUpdated }) {
  const [pending, setPending] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  const invokerRef = useRef(null);

  useEffect(() => {
    invokerRef.current = document.activeElement;
    const first = dialogRef.current?.querySelector('[data-status-option]');
    first?.focus();
    return () => {
      if (invokerRef.current && typeof invokerRef.current.focus === 'function') {
        invokerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function stage(next) {
    if (next === report.status) {
      onClose();
      return;
    }
    setPending(next);
    setMessage('');
    setNeedsConfirm(true);
  }

  async function applyStatus() {
    setBusy(true);
    setMessage('');
    try {
      // Every status change is explicitly confirmed in this dialog, so the
      // downgrade flag travels with the confirmed request.
      const updated = await api.updateStatus(report.id, pending, { confirmDowngrade: true });
      onUpdated(updated);
      onClose();
    } catch (error) {
      setMessage(error?.message || 'Status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dlg-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="dlg" role="dialog" aria-modal="true" aria-labelledby="status-dialog-title">
        {!needsConfirm ? (
          <>
            <h2 id="status-dialog-title">Update report status</h2>
            <p className="dlg-sub">Choose the local label that reflects your team&rsquo;s latest update.</p>
            <div className="m-status-options" role="group" aria-label="Report status choices">
              {['Draft', 'Submitted', 'Resolved'].map((option) => (
                <button
                  key={option}
                  type="button"
                  data-status-option
                  className={`m-status-option${report.status === option ? ' is-current' : ''}`}
                  aria-pressed={report.status === option}
                  disabled={busy}
                  onClick={() => stage(option)}
                >
                  {option}
                  {report.status === option && <span className="m-current-note"> · Current</span>}
                </button>
              ))}
            </div>
            <p className="dlg-note">Status labels do not confirm submission to an agency or an official resolution.</p>
            {message && (
              <p className="w-form-error" role="alert">
                {message}
              </p>
            )}
            <button type="button" className="m-danger" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 id="status-dialog-title">Move report to {pending}?</h2>
            <p className="dlg-sub">
              {message || 'Moving a report changes its label in ProofPath. It does not notify any agency.'}
            </p>
            <p className="dlg-note">Observed {formatLongDate(report.observed_date) || 'date not recorded'} · {report.public_code || 'no public code'}</p>
            {message && (
              <p className="w-form-error" role="alert">
                {message}
              </p>
            )}
            <div className="m-dialog-actions">
              <button type="button" className="m-danger" disabled={busy} onClick={applyStatus}>
                {busy ? 'Updating…' : `Confirm move to ${pending}`}
              </button>
              <button
                type="button"
                className="w-outline"
                disabled={busy}
                onClick={() => {
                  setNeedsConfirm(false);
                  setMessage('');
                }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { statusClass };
