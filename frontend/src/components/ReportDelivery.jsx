import React, { useEffect, useRef, useState } from 'react';
import { api, formatLongDate, isVideoReport } from '../api.js';

function PdfReadyDialog({ report, onView, onClose }) {
  const closeRef = useRef(null);
  const publicCode = report.public_code || 'PP-0000';
  const selected = (report.observations || []).filter((item) => item.selected);
  const mediaLabel = isVideoReport(report) ? '1 video' : '1 photo';
  const countsLine = `${mediaLabel} · ${selected.length} observation${selected.length === 1 ? '' : 's'}`;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dlg-scrim is-black"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="pdf-ready-title">
        <h2 id="pdf-ready-title">Your PDF is ready</h2>
        <p className="m-pdf-name">{publicCode}.pdf</p>
        <p className="dlg-sub">{countsLine}</p>
        <p className="dlg-sub">Your report includes the attached photo and the details you reviewed.</p>
        <button type="button" className="w-primary w-block" onClick={onView}>
          View PDF
        </button>
        <button ref={closeRef} type="button" className="w-link m-dialog-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function PdfErrorDialog({ onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="dlg-scrim is-black"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="pdf-error-title">
        <h2 id="pdf-error-title">Could not prepare the PDF</h2>
        <p className="dlg-sub">Could not prepare the PDF. Try again.</p>
        <button ref={closeRef} type="button" className="w-primary w-block" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export default function ReportDelivery({ report, backLabel = 'Back to saved report', onBack, onViewPreview }) {
  const [busy, setBusy] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const publicCode = report.public_code || 'PP-0000';
  const observed = formatLongDate(report.observed_date);
  const selected = (report.observations || []).filter((item) => item.selected);
  const mediaLabel = isVideoReport(report) ? '1 video' : '1 photo';
  const countsLine = `${mediaLabel} · ${selected.length} confirmed observation${selected.length === 1 ? '' : 's'}`;

  async function downloadPdf() {
    setBusy(true);
    try {
      const blob = await api.downloadReportPdf(report.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${publicCode}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      setReadyOpen(true);
    } catch {
      setErrorOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-flow m-delivery" aria-labelledby="delivery-heading">
      <h1 id="delivery-heading">Download your report</h1>
      <p className="w-sub">Keep a copy to share through your chosen channel.</p>
      <div className="m-delivery-layout">
        <article className="m-delivery-doc" aria-label="Report summary">
          <h2>{report.title}</h2>
          <p className="m-delivery-meta">
            {report.category}
            {observed ? ` · Observed ${observed}` : ''}
          </p>
          <span className="w-rule" aria-hidden="true" />
          <h3>Description</h3>
          <p>{report.description}</p>
          <h3>Resident context</h3>
          <p className="w-quote">&ldquo;{report.resident_context || 'No additional context was provided.'}&rdquo;</p>
          <span className="w-rule" aria-hidden="true" />
          <p className="m-delivery-counts">{countsLine}</p>
        </article>
        <aside className="m-ready-card" aria-label="Ready to download">
          <h2>Ready to download</h2>
          <p className="m-pdf-name">{publicCode}.pdf</p>
          <p className="m-delivery-meta">{mediaLabel} · {selected.length} observations</p>
          <button type="button" className="w-primary w-block" disabled={busy} onClick={downloadPdf}>
            {busy ? 'Preparing PDF…' : 'Download PDF'}
          </button>
          <p className="m-channel-hint">Send the file through your preferred reporting channel. Update the report status after you deliver it.</p>
        </aside>
      </div>
      <div className="w-foot">
        <button type="button" className="w-link" onClick={onBack}>
          {backLabel}
        </button>
      </div>
      {readyOpen && <PdfReadyDialog report={report} onView={onViewPreview} onClose={() => setReadyOpen(false)} />}
      {errorOpen && <PdfErrorDialog onClose={() => setErrorOpen(false)} />}
    </section>
  );
}
