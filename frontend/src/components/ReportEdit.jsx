import React, { useState } from 'react';
import { CATEGORIES } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const MAX_LENGTHS = { title: 120, category: 60, location: 180, description: 2000 };

export default function ReportEdit({ report, onCancel, onSave }) {
  const [fields, setFields] = useState({
    title: report.title || '',
    category: report.category || '',
    location: report.location || '',
    description: report.description || '',
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirty =
    (fields.title || '') !== (report.title || '') ||
    (fields.category || '') !== (report.category || '') ||
    (fields.location || '') !== (report.location || '') ||
    (fields.description || '') !== (report.description || '');

  function requestCancel() {
    if (dirty && !busy) setConfirmDiscard(true);
    else onCancel();
  }

  function set(name, value) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      const payload = {
        title: fields.title.trim(),
        category: fields.category.trim(),
        location: fields.location.trim() || null,
        description: fields.description.trim(),
      };
      await onSave(payload);
    } catch (error) {
      setMessage(error?.message || 'Report could not be updated.');
      setBusy(false);
    }
  }

  const titleCount = `${fields.title.trim().length}/${MAX_LENGTHS.title}`;
  const valid =
    fields.title.trim().length >= 3 &&
    fields.title.trim().length <= MAX_LENGTHS.title &&
    fields.category.trim().length >= 1 &&
    fields.description.trim().length >= 10;

  return (
    <section className="w-flow m-edit" aria-labelledby="edit-report-heading">
      <p className="eyebrow">Community report</p>
      <h1 id="edit-report-heading">Edit report</h1>
      <p className="w-sub">Keep the description grounded in the photo and confirmed details.</p>
      <form className="m-edit-card" onSubmit={submit}>
        <p className="m-readonly-evidence" aria-label="Attached evidence (read-only)">
          <span className="m-readonly-label">Evidence</span>
          <span>
            {report.evidence_name || 'Attached evidence'} · read-only
          </span>
        </p>
        <label className="m-field">
          Report title
          <input
            name="title"
            value={fields.title}
            maxLength={MAX_LENGTHS.title}
            onChange={(event) => set('title', event.target.value)}
            aria-describedby="edit-title-hint"
          />
          <span className="m-hint" id="edit-title-hint">
            Maximum 120 characters. <span aria-live="polite">{titleCount}</span>
          </span>
        </label>
        <label className="m-field">
          Category
          <select name="category" value={fields.category} onChange={(event) => set('category', event.target.value)} aria-describedby="edit-category-hint">
            <option value="">Choose a category</option>
            {CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span className="m-hint" id="edit-category-hint">
            Choose the category that best describes the concern.
          </span>
        </label>
        <label className="m-field">
          Location
          <input
            name="location"
            value={fields.location}
            maxLength={MAX_LENGTHS.location}
            onChange={(event) => set('location', event.target.value)}
            aria-describedby="edit-location-hint"
          />
          <span className="m-hint" id="edit-location-hint">
            Only include a location you can confirm.
          </span>
        </label>
        <label className="m-field">
          Description
          <textarea
            name="description"
            rows={5}
            maxLength={MAX_LENGTHS.description}
            value={fields.description}
            onChange={(event) => set('description', event.target.value)}
            aria-describedby="edit-description-hint"
          />
          <span className="m-hint" id="edit-description-hint">
            Review all suggested wording before saving.
          </span>
        </label>
        {message && (
          <p className="w-form-error" role="alert">
            {message}
          </p>
        )}
        <div className="m-edit-actions">
          <button type="submit" className="w-primary" disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="w-link" onClick={requestCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
      {confirmDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          body="Your edits to this report have not been saved. Discarding them cannot be undone."
          confirmLabel="Discard changes"
          safeLabel="Keep editing"
          onConfirm={onCancel}
          onClose={() => setConfirmDiscard(false)}
        />
      )}
    </section>
  );
}
