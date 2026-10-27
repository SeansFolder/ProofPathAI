import React, { useState } from 'react';
import { api } from '../api.js';

export default function SavedScreen({ report, previewUrl, isVideo, canStatus, onBack, onReview, onStatusUpdated }) {
  const [status, setStatus] = useState(report.status);
  const [activity, setActivity] = useState(`${report.status} saved just now`);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const meta = [report.category, report.location,
    new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(report.created_at)),
  ]
    .filter(Boolean)
    .join(' · ');

  async function markSubmitted() {
    setBusy(true);
    setMessage('');
    try {
      const updated = await api.updateStatus(report.id, 'Submitted');
      setStatus(updated.status);
      setActivity('Status updated to Submitted just now');
      setMessage('Status updated in ProofPath. The report was not sent to an agency.');
      onStatusUpdated(updated);
    } catch (error) {
      setMessage(error.message || 'Status could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const content = [
      `# ${report.title}`,
      '',
      `- Status: ${status}`,
      `- Category: ${report.category}`,
      `- Location: ${report.location || 'Not provided'}`,
      `- Created: ${new Date(report.created_at).toLocaleString()}`,
      `- Evidence file: ${report.evidence_name}`,
      '',
      '## Observation',
      report.description,
      '',
      'ProofPath stores this report. It has not been sent to an agency.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proofpath-report'}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="saved-screen" aria-labelledby="saved-heading">
      <div className="saved-mark" aria-hidden="true">
        ✓
      </div>
      <p className="eyebrow">REPORT SAVED</p>
      <h1 id="saved-heading">Your report is saved.</h1>
      <p>Your evidence and report details are together in your journal.</p>
      <div className="saved-layout">
        <article className="saved-card">
          <div className="saved-card-heading">
            <div>
              <h2>{report.title}</h2>
              <p>{meta}</p>
            </div>
            <span className="status-badge">{status}</span>
          </div>
          <div>
            {isVideo ? (
              <video src={previewUrl} controls playsInline style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 9, background: '#eef1eb' }} />
            ) : (
              <img src={previewUrl} alt={`Evidence for ${report.title}`} style={{ width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 9, background: '#eef1eb' }} />
            )}
          </div>
          <div className="saved-activity">
            <h3>Activity</h3>
            <p>{activity}</p>
          </div>
        </article>
        <aside className="saved-actions-panel">
          <p className="eyebrow">REPORT ACTIONS</p>
          <h2>Current status</h2>
          <p className="saved-status-copy">Update this after delivering the report through your chosen channel.</p>
          {canStatus && (
            <button className="submit-button" type="button" disabled={busy || status !== 'Draft'} onClick={markSubmitted}>
              Mark as submitted
            </button>
          )}
          <button className="secondary-action" type="button" onClick={download}>
            Download report
          </button>
          <p role="status">{message}</p>
        </aside>
      </div>
      <div className="saved-actions">
        <button className="text-link" type="button" onClick={onBack}>
          ← Back to reports
        </button>
        <button className="submit-button" type="button" onClick={onReview}>
          Review this report
        </button>
      </div>
    </section>
  );
}
