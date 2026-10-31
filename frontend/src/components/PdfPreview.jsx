import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PrintableReport from './PrintableReport.jsx';

// PDF preview renders the same server-generated PDF bytes as the download
// (GET /api/reports/{id}/pdf), so preview and download share one layout,
// one set of privacy-filtered values, and real pagination. The printable
// layout below is only a fallback when the PDF bytes cannot load.
export default function PdfPreview({ report, onBack }) {
  const [pdfUrl, setPdfUrl] = useState('');
  const [status, setStatus] = useState('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setStatus('loading');
    setPdfUrl('');
    (async () => {
      try {
        const blob = await api.downloadReportPdf(report.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [report.id, reloadKey]);

  return (
    <div className="m-preview">
      <header className="m-preview-bar">
        <span className="m-preview-brand">ProofPath</span>
        <span className="m-preview-label">PDF preview</span>
        <span className="m-preview-actions">
          {pdfUrl && (
            <a className="w-link" href={pdfUrl} download={`${report.public_code || 'report'}.pdf`}>
              Download PDF
            </a>
          )}
          <button type="button" className="w-link" onClick={onBack}>
            Back to download
          </button>
        </span>
      </header>
      <main className="m-preview-body">
        {status === 'loading' && (
          <p className="w-sub" role="status" aria-live="polite">
            Preparing your PDF preview…
          </p>
        )}
        {status === 'ready' && pdfUrl && (
          <iframe
            className="m-preview-frame"
            title={`PDF preview for ${report.title}`}
            src={pdfUrl}
          />
        )}
        {status === 'error' && (
          <div className="m-preview-fallback">
            <p className="w-form-error" role="alert">
              The PDF preview could not be loaded. Try again — your download uses the same document.
            </p>
            <button type="button" className="w-secondary" onClick={() => setReloadKey((value) => value + 1)}>
              Try again
            </button>
            <PrintableReport report={report} />
          </div>
        )}
      </main>
    </div>
  );
}
