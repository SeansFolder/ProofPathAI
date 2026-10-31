import React from 'react';
import JournalCard from './JournalCard.jsx';
import './Journal.css';

export default function Dashboard({
  sessionUser,
  reports,
  canView,
  canCreate,
  canEdit,
  canStatus,
  canDelete,
  highlightId,
  reportsError,
  onOpenWizard,
  onOpenReport,
  onOpenPassword,
  onRetry,
}) {
  const roleLabel = sessionUser?.role === 'super_admin' ? 'SUPER ADMIN' : sessionUser?.role === 'resident' ? 'RESIDENT' : 'ADMIN';
  const ownOnly = sessionUser?.role === 'resident';
  const viewOnly = canView && !canCreate && !canEdit && !canStatus && !canDelete;

  return (
    <section className="journal" id="dashboard" aria-labelledby="journal-heading">
      <div className="journal-heading">
        <div>
          <p className="eyebrow">{roleLabel}</p>
          <h1 id="journal-heading">{ownOnly ? 'My reports' : 'Community reports'}</h1>
          <p className="journal-intro">{ownOnly ? 'Reports you created, with their evidence and follow-up.' : 'A shared record of community concerns, supporting evidence, and follow-up.'}</p>
        </div>
        <div className="journal-heading-actions">
          {canCreate && (
            <button className="journal-new-report" type="button" onClick={onOpenWizard}>
              New report
            </button>
          )}
          <button className="journal-outline-button" type="button" onClick={onOpenPassword}>
            Change password
          </button>
        </div>
      </div>

      {!canView && (
        <div className="journal-no-access">
          <h2>Report access has not been enabled</h2>
          <p>Your account is active, but no report permissions have been assigned. Ask a super admin to update your access.</p>
          <button type="button" className="journal-outline-button" onClick={onOpenPassword}>
            Change my password
          </button>
        </div>
      )}

      {canView && (
        <>
          {viewOnly && (
            <p className="journal-notice" role="status">
              View-only access. Ask a super admin if you need to create or update reports.
            </p>
          )}
          <div className="journal-toolbar">
            <p className="eyebrow">REPORT JOURNAL</p>
            <span className="journal-workspace">{ownOnly ? 'Personal workspace' : 'Shared workspace'}</span>
          </div>
          {reportsError && reports.length > 0 && (
            <p className="journal-notice" role="alert">
              Reports could not be refreshed. Showing the last loaded list.{' '}
              {onRetry && (
                <button type="button" className="text-link" onClick={onRetry}>
                  Try again
                </button>
              )}
            </p>
          )}
          <div className="journal-list" aria-live="polite">
            {reportsError && reports.length === 0 && (
              <div className="empty-state">
                <span className="empty-line" aria-hidden="true"></span>
                <p>Reports could not be loaded</p>
                <span>Check your connection and try again — this is not the same as having no reports.</span>
                {onRetry && (
                  <button className="text-link empty-new-report" type="button" onClick={onRetry}>
                    Try again <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            )}
            {!reportsError && reports.length === 0 && (
              <div className="empty-state">
                <span className="empty-line" aria-hidden="true"></span>
                <p>No reports yet</p>
                <span>Reports shared with this workspace will appear here.</span>
                {canCreate && (
                  <button className="text-link empty-new-report" type="button" onClick={onOpenWizard}>
                    Start a report <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            )}
            {reports.map((report) => (
              <JournalCard
                key={report.id}
                report={report}
                canEdit={canEdit}
                canStatus={canStatus}
                canDelete={canDelete}
                highlighted={highlightId === report.id}
                onOpen={onOpenReport}
              />
            ))}
          </div>
          <p className="journal-footnote">Submitted and Resolved are local status labels. They do not confirm an agency response.</p>
        </>
      )}
    </section>
  );
}
