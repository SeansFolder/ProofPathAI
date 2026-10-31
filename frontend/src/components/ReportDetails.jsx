import React from 'react';
import { evidenceUrlFor, formatLongDate, isVideoReport } from '../api.js';
import { statusClass } from './StatusDialog.jsx';

export default function ReportDetails({
  report,
  canEdit,
  canStatus,
  canDelete,
  canDownload,
  onBack,
  onEdit,
  onChangeStatus,
  onAskDelete,
  onDownload,
}) {
  const video = isVideoReport(report);
  const observed = formatLongDate(report.observed_date);

  return (
    <section className="w-flow m-details" aria-labelledby="report-details-heading">
      <p className="eyebrow">Community report</p>
      <h1 id="report-details-heading">Report details</h1>
      <p className="w-sub">Review the evidence and update only what you can confirm.</p>
      <div className="m-details-top">
        <button type="button" className="w-link" onClick={onBack}>
          Back to reports
        </button>
        <span className={`w-status-pill ${statusClass(report.status)}`}>{report.status}</span>
      </div>
      <div className="m-details-layout">
        <div className="m-photo-panel">
          {video ? (
            <a className="m-photo-fallback" href={evidenceUrlFor(report)} target="_blank" rel="noreferrer">
              Open attached video evidence
            </a>
          ) : (
            <img src={evidenceUrlFor(report)} alt={`Original evidence for ${report.title}`} />
          )}
          <p className="m-photo-caption">{video ? 'Original video · 1 attachment' : 'Original photo · 1 attachment'}</p>
        </div>
        <div className="m-details-body">
          <h2>{report.title}</h2>
          <p className="m-caps">{report.category}</p>
          {observed && <p className="m-observed">Observed {observed}</p>}
          {report.location && <p className="m-location">{report.location}</p>}
          <p className="m-description">{report.description}</p>
          {report.resident_context && <p className="m-context">&ldquo;{report.resident_context}&rdquo;</p>}
          <div className="m-details-actions">
            {canDownload && onDownload && (
              <button type="button" className="w-secondary" onClick={onDownload}>
                Download PDF
              </button>
            )}
            {canEdit && (
              <button type="button" className="w-secondary" onClick={onEdit}>
                Edit details
              </button>
            )}
            {canStatus && (
              <button type="button" className="w-secondary" onClick={onChangeStatus}>
                Change status
              </button>
            )}
            {canDelete && (
              <button type="button" className="w-link m-delete-link" onClick={onAskDelete}>
                Delete report
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="m-footnote">Report status is maintained by your team. The platform does not submit reports to an agency automatically.</p>
    </section>
  );
}
