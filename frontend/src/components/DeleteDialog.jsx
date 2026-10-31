import React, { useState } from 'react';
import { api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function DeleteDialog({ report, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function confirmDelete() {
    setBusy(true);
    setMessage('');
    try {
      await api.deleteReport(report.id);
      onDeleted(report.id);
      onClose();
    } catch (error) {
      setMessage(error?.message || 'Report could not be deleted.');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Delete this report?"
      body="This permanently removes the report and its attached evidence. This action cannot be undone."
      detail={report.title}
      confirmLabel="Delete report"
      safeLabel="Keep report"
      busy={busy}
      busyLabel="Deleting…"
      error={message}
      onConfirm={confirmDelete}
      onClose={onClose}
    />
  );
}
