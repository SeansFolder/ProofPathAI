import React, { useEffect, useRef, useState } from 'react';
import { STATUSES, api } from '../api.js';

const MAX_LENGTHS = { title: 120, category: 60, location: 180, description: 2000 };

export default function ReportItem({ report, canEdit, canStatus, canDelete, highlighted, onUpdate, onDelete }) {
  const [status, setStatus] = useState(report.status);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState({
    title: report.title,
    category: report.category,
    location: report.location || '',
    description: report.description,
  });
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  useEffect(() => {
    setStatus(report.status);
  }, [report.status]);

  async function onStatusChange(event) {
    const next = event.target.value;
    const previous = status;
    setStatus(next);
    setStatusBusy(true);
    setStatusError('');
    try {
      const updated = await api.updateStatus(report.id, next);
      onUpdate(updated);
    } catch (error) {
      setStatus(previous);
      setStatusError(error.message || 'Status could not be updated.');
    } finally {
      setStatusBusy(false);
    }
  }

  async function onSaveEdit(event) {
    event.preventDefault();
    setSaveBusy(true);
    setStatusError('');
    try {
      const payload = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.trim() || null]));
      const updated = await api.editReport(report.id, payload);
      onUpdate(updated);
      setEditing(false);
    } catch (error) {
      setStatusError(error.message || 'Report could not be updated.');
    } finally {
      setSaveBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm(`Permanently delete “${report.title}” and its evidence?`)) return;
    setDeleteBusy(true);
    try {
      await api.deleteReport(report.id);
      onDelete(report.id);
    } catch (error) {
      setStatusError(error.message || 'Report could not be deleted.');
      setDeleteBusy(false);
    }
  }

  const created = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(report.created_at)
  );

  return (
    <article ref={cardRef} className={`report-item${highlighted ? ' is-highlighted' : ''}`} data-report-id={report.id}>
      <div className="report-item-head">
        <h3>{report.title}</h3>
        {canStatus && (
          <select className="status-select" aria-label={`Update status for ${report.title}`} value={status} disabled={statusBusy} onChange={onStatusChange}>
            {STATUSES.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        )}
        {canEdit && (
          <button type="button" className="delete-report edit-report" aria-label={`Edit ${report.title}`} onClick={() => setEditing((value) => !value)}>
            Edit
          </button>
        )}
        {canDelete && (
          <button type="button" className="delete-report" aria-label={`Delete ${report.title}`} disabled={deleteBusy} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {statusError && (
        <span className="status-error" role="status">
          {statusError}
        </span>
      )}
      {editing && (
        <form className="edit-report-form" onSubmit={onSaveEdit}>
          {[
            ['title', 'Title', false],
            ['category', 'Category', false],
            ['location', 'Location', false],
            ['description', 'Description', true],
          ].map(([name, label, multiline]) => (
            <label key={name}>
              {label}
              {multiline ? (
                <textarea name={name} rows={3} maxLength={MAX_LENGTHS[name]} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />
              ) : (
                <input name={name} maxLength={MAX_LENGTHS[name]} value={fields[name]} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />
              )}
            </label>
          ))}
          <button type="submit" disabled={saveBusy}>
            Save changes
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      )}
      <div className="report-meta">
        <span>{report.category}</span>
        <span>{created}</span>
        {report.location && <span>{report.location}</span>}
      </div>
      <p className="report-description">{report.description}</p>
      {report.evidence_type.startsWith('image/') ? (
        <img className="report-evidence" src={`/api/evidence/${encodeURIComponent(report.evidence_name)}`} alt={`Evidence for ${report.title}`} loading="lazy" />
      ) : (
        <a className="report-description" href={`/api/evidence/${encodeURIComponent(report.evidence_name)}`} target="_blank" rel="noreferrer">
          Open attached video evidence
        </a>
      )}
    </article>
  );
}
