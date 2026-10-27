import React, { useMemo, useState } from 'react';
import ReportItem from './ReportItem.jsx';

export default function Dashboard({
  reports,
  canView,
  canCreate,
  canEdit,
  canStatus,
  canDelete,
  highlightId,
  onOpenWizard,
  onUpdateReport,
  onDeleteReport,
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((report) => {
      const searchable = [report.title, report.category, report.description, report.location || ''].join(' ').toLowerCase();
      return (!q || searchable.includes(q)) && (!statusFilter || report.status === statusFilter);
    });
  }, [reports, query, statusFilter]);

  if (!canView) return null;

  return (
    <section className="journal" id="dashboard" aria-labelledby="journal-heading">
      <div className="journal-heading">
        <div>
          <p className="eyebrow">YOUR COMMUNITY JOURNAL</p>
          <h1 id="journal-heading">Your reports</h1>
          <p className="journal-intro">A clear record of what you noticed, with evidence and follow-up in one place.</p>
        </div>
        {canCreate && (
          <button className="submit-button new-report-button" type="button" onClick={onOpenWizard}>
            <span>New report</span>
            <span aria-hidden="true">+</span>
          </button>
        )}
      </div>

      <section className="reports-panel" aria-label="Saved reports">
        <div className="reports-toolbar">
          <div>
            <p className="eyebrow">REPORT JOURNAL</p>
            <span className="reports-subtitle">Your saved reports stay with your account.</span>
          </div>
          <span className="report-count">{reports.length}</span>
        </div>
        <div className="report-filters">
          <label className="sr-only" htmlFor="report-search">
            Search reports
          </label>
          <input id="report-search" type="search" placeholder="Search reports" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label className="sr-only" htmlFor="status-filter">
            Filter by status
          </label>
          <select id="status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">All statuses</option>
            <option>Draft</option>
            <option>Submitted</option>
            <option>Resolved</option>
          </select>
        </div>
        <div className="report-list" aria-live="polite">
          {visible.length === 0 && reports.length === 0 && (
            <div className="empty-state">
              <span className="empty-line" aria-hidden="true"></span>
              <p>No reports yet</p>
              <span>Start with a photo of something you noticed.</span>
              {canCreate && (
                <button className="text-link empty-new-report" type="button" onClick={onOpenWizard}>
                  Start a report <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}
          {visible.length === 0 && reports.length > 0 && <p className="empty-state">No reports match these filters.</p>}
          {visible.map((report) => (
            <ReportItem
              key={report.id}
              report={report}
              canEdit={canEdit}
              canStatus={canStatus}
              canDelete={canDelete}
              highlighted={highlightId === report.id}
              onUpdate={onUpdateReport}
              onDelete={onDeleteReport}
            />
          ))}
        </div>
        <p className="panel-footnote">
          <span className="footnote-dot"></span>Submitted and resolved are personal tracking labels; they do not contact an agency.
        </p>
      </section>
    </section>
  );
}
