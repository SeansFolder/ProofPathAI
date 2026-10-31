import React, { useState } from 'react';
import { api, formatLongDate } from '../api.js';

const HEADINGS = {
  Draft: { title: 'Report saved', sub: 'Your report is saved as a draft.' },
  Submitted: { title: 'Report submitted', sub: 'Status updated after you delivered the report.' },
  Resolved: { title: 'Report resolved', sub: 'Status updated after you confirmed the issue was addressed.' },
};

const ACTIVITY = {
  Draft: { label: 'Draft saved', counts: null },
  Submitted: { label: 'Marked as submitted', counts: 'Submission status updated.' },
  Resolved: { label: 'Marked as resolved', counts: 'Resolution status updated.' },
};

export default function SavedScreen({ report, previewUrl, isVideo, canStatus, onBack, onReview, onDownload, onStatusUpdated }) {
  const [status, setStatus] = useState(report.status);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const heading = HEADINGS[status] || HEADINGS.Draft;
  const activity = ACTIVITY[status] || ACTIVITY.Draft;
  const selected = (report.observations || []).filter((item) => item.selected);
  const attachmentCount = report.evidence_name ? 1 : 0;
  const attachmentLabel = attachmentCount === 0 ? 'No evidence' : isVideo ? '1 video' : '1 photo';
  const countsLine = `${attachmentLabel} · ${selected.length} confirmed observation${selected.length === 1 ? '' : 's'}`;
  const publicCode = report.public_code || 'PP-0000';
  const createdLong = formatLongDate((report.created_at || '').slice(0, 10)) ||
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(report.created_at));

  async function markStatus(next) {
    setBusy(true);
    setMessage('');
    try {
      const updated = await api.updateStatus(report.id, next);
      setStatus(updated.status);
      setMessage('Status updated in ProofPath. The report was not sent to an agency.');
      onStatusUpdated(updated);
    } catch (error) {
      setMessage(error?.message || 'Status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-flow w-saved" aria-labelledby="saved-heading">
      <h1 id="saved-heading">{heading.title}</h1>
      <p className="w-sub">{heading.sub}</p>
      <div className="w-saved-layout">
        <article className="w-saved-card">
          <div className="w-saved-head">
            <div>
              <h2>{report.title}</h2>
              <p>{`${publicCode} · Created ${createdLong}`}</p>
            </div>
            <span className="w-status-pill">{status}</span>
          </div>
          <div className="w-saved-media">
            {isVideo ? (
              <video src={previewUrl} controls playsInline />
            ) : (
              <img src={previewUrl} alt={`Evidence for ${report.title}`} />
            )}
          </div>
          <p className="w-saved-location">
            <span aria-hidden="true">◎</span> {report.location || 'No location provided'}
          </p>
          <div className="w-rule" />
          <h3>Activity</h3>
          <p className="w-activity-row">
            <span className="w-activity-check" aria-hidden="true">✓</span>
            <strong>{activity.label}</strong>
            <span className="w-activity-when">Just now</span>
          </p>
          <p className="w-activity-counts">{activity.counts || countsLine}</p>
        </article>
        <aside className="w-actions-panel">
          <h2>Report actions</h2>
          <p className="w-actions-row">
            <strong>Current status</strong>
            <span>{status}</span>
          </p>
          <button className="w-primary w-block" type="button" onClick={onDownload}>
            Download report
          </button>
          <div className="w-rule" />
          {status === 'Draft' && (
            <>
              <p className="w-actions-hint">Update this after delivering the report.</p>
              {canStatus && (
                <button className="w-secondary w-block" type="button" disabled={busy} onClick={() => markStatus('Submitted')}>
                  {busy ? 'Updating…' : 'Mark as submitted'}
                </button>
              )}
            </>
          )}
          {status === 'Submitted' && (
            <>
              <p className="w-actions-hint">Update this after confirming the issue is resolved.</p>
              {canStatus && (
                <button className="w-secondary w-block" type="button" disabled={busy} onClick={() => markStatus('Resolved')}>
                  {busy ? 'Updating…' : 'Mark as resolved'}
                </button>
              )}
            </>
          )}
          {status === 'Resolved' && <p className="w-actions-hint">Your evidence remains attached to this report.</p>}
          <p className="w-form-error" role="status" aria-live="polite">
            {message}
          </p>
        </aside>
      </div>
      <div className="w-foot">
        <button className="w-link" type="button" onClick={onBack}>
          Back to reports
        </button>
        <button className="w-outline" type="button" onClick={onReview}>
          Review this report
        </button>
      </div>
    </section>
  );
}
