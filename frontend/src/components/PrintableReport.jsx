import React from 'react';
import logo from '../assets/logo.png';
import { evidenceUrlFor, formatLongDate, isVideoReport } from '../api.js';

/**
 * Frame 21 printable A4 body. Used by the browser print path (@media print)
 * and as the PDF preview fallback when the server document cannot load.
 * Mirrors the server PDF (GET /api/reports/{id}/pdf) field order and wording.
 */
export default function PrintableReport({ report }) {
  const publicCode = report.public_code || 'PP-0000';
  const observed = formatLongDate(report.observed_date);
  const selected = (report.observations || []).filter((item) => item.selected);
  const countsLine = `1 photo · ${selected.length} confirmed observation${selected.length === 1 ? '' : 's'}`;
  const video = isVideoReport(report);

  return (
    <article className="m-a4-sheet" aria-label={`Printable report ${publicCode}`}>
      <header className="m-a4-head">
        <img className="m-a4-logo" src={logo} alt="ProofPath" />
        <span className="m-a4-rule" aria-hidden="true" />
      </header>
      <h2 className="m-a4-title">{report.title}</h2>
      <p className="m-a4-kicker">Community issue report · {publicCode}</p>
      <p className="m-a4-line">
        <strong>Location: {report.location || 'No location provided'}</strong>
      </p>
      <p className="m-a4-line">
        {report.category}
        {observed ? ` · Observed ${observed}` : ''}
      </p>
      <h3 className="m-a4-h">Description</h3>
      <p className="m-a4-p">{report.description}</p>
      {report.resident_context && (
        <>
          <h3 className="m-a4-h">Resident context</h3>
          <p className="m-a4-p">{report.resident_context}</p>
        </>
      )}
      <p className="m-a4-counts">{countsLine}</p>
      {video ? (
        <p className="m-a4-p">Video evidence is attached to the online report and is not embedded in this printable copy.</p>
      ) : (
        <img className="m-a4-photo" src={evidenceUrlFor(report)} alt={`Original evidence for ${report.title}`} />
      )}
      {!video && <p className="m-a4-caption">Original evidence · {report.evidence_name}</p>}
      <footer className="m-a4-foot">
        Prepared from resident-supplied information. Status: {report.status}.
      </footer>
    </article>
  );
}
