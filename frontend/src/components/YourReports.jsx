import React from 'react';
import JournalCard from './JournalCard.jsx';
import './Journal.css';

// Handoff screens 01 (signed-out prompt) and 02 (signed-in empty state),
// plus the populated resident list. Frames 01/02 are states of one screen,
// not two dashboards: the signed-out state prompts sign-in, the signed-in
// state shows this resident's own reports, and an empty account shows 02.
// A populated account reuses the existing report-card language.
export default function YourReports({
  sessionUser,
  reports,
  canEdit,
  canStatus,
  canDelete,
  highlightId,
  reportsError,
  onSignIn,
  onNewReport,
  onOpenReport,
  onRetry,
}) {
  const signedIn = Boolean(sessionUser);

  return (
    <section className="yr" aria-labelledby="yr-heading">
      <div className="yr-head">
        <h1 id="yr-heading">Your reports</h1>
        <button type="button" className="yr-new" onClick={onNewReport}>
          <span aria-hidden="true">+</span> New report
        </button>
      </div>
      <div className="yr-rule" aria-hidden="true" />
      {!signedIn ? (
        <div className="yr-body">
          <p className="yr-strong">Your saved reports stay with your account.</p>
          <p className="yr-sub">
            <button type="button" className="yr-inline-link" onClick={() => onSignIn()}>
              Sign in
            </button>{' '}
            to view them, or start a new report.
          </p>
        </div>
      ) : reportsError && reports.length === 0 ? (
        <div className="yr-body">
          <p className="yr-strong">Reports could not be loaded</p>
          <p className="yr-sub">Check your connection and try again — this is not the same as having no reports.</p>
          {onRetry && (
            <p className="yr-sub">
              <button type="button" className="yr-inline-link" onClick={onRetry}>
                Try again
              </button>
            </p>
          )}
        </div>
      ) : reports.length === 0 ? (
        <div className="yr-body">
          <p className="yr-strong">No reports yet</p>
          <p className="yr-sub">Start with a photo of a community issue.</p>
        </div>
      ) : (
        <>
          {reportsError && (
            <p className="yr-sub" role="alert">
              Reports could not be refreshed. Showing the last loaded list.{' '}
              {onRetry && (
                <button type="button" className="yr-inline-link" onClick={onRetry}>
                  Try again
                </button>
              )}
            </p>
          )}
          <div className="yr-list">
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
        </>
      )}
    </section>
  );
}
