import React, { useEffect, useRef } from 'react';
import { evidenceUrlFor, isVideoReport } from '../api.js';
import './Journal.css';

export default function JournalCard({ report, canEdit, canStatus, canDelete, highlighted, onOpen }) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  const video = isVideoReport(report);
  const actionsHint = [canEdit && 'edit', canStatus && 'status', canDelete && 'delete'].filter(Boolean).join(' · ');

  return (
    <article ref={cardRef} className={`journal-card${highlighted ? ' is-highlighted' : ''}`} data-report-id={report.id}>
      <div className="journal-card-main">
        {video ? (
          <a className="journal-card-photo journal-card-video" href={evidenceUrlFor(report)} target="_blank" rel="noreferrer">
            Open attached video evidence
          </a>
        ) : (
          <img className="journal-card-photo" src={evidenceUrlFor(report)} alt={`Evidence for ${report.title}`} loading="lazy" />
        )}
        <div className="journal-card-body">
          <p className="journal-card-tags">
            <span className={`status-pill status-${report.status.toLowerCase()}`}>{report.status}</span>
            <span className="journal-card-category">{report.category}</span>
          </p>
          <h2>{report.title}</h2>
          {report.location && <p className="journal-card-location">{report.location}</p>}
          <p className="journal-card-description">{report.description}</p>
          <button type="button" className="journal-outline-button" onClick={() => onOpen(report)} aria-label={`Open report ${report.title}`}>
            Open report
          </button>
          {actionsHint && (
            <p className="journal-card-perms">
              Available: {actionsHint}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
