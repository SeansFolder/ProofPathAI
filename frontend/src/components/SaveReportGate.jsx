import React, { useEffect, useState } from 'react';
import logo from '../assets/logo.png';

// Handoff screen 10: save-report account gate. The draft (photo, reviewed
// details, location, privacy choices) is held by the parent and restored
// when the resident returns via "Back to my report" or completes
// sign-in/create-account; nothing here uploads or claims the draft.
export default function SaveReportGate({ draft, onCreateAccount, onSignIn, onBackToReport, onBackHome, onPrivacyHelp }) {
  const [thumbUrl, setThumbUrl] = useState('');

  useEffect(() => {
    if (draft?.file && draft.file.type?.startsWith('image/')) {
      const url = URL.createObjectURL(draft.file);
      setThumbUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setThumbUrl('');
    return undefined;
  }, [draft]);

  const title = draft?.title?.trim() || 'Untitled report';

  return (
    <div className="signin">
      <header className="signin-header">
        <div className="signin-header-inner">
          <a href="/" aria-label="ProofPath home" onClick={(event) => { event.preventDefault(); onBackHome(); }}>
            <img className="brand-lockup" src={logo} alt="ProofPath" />
          </a>
          <button type="button" className="signin-back" onClick={onBackHome}>
            Back to home
          </button>
        </div>
      </header>
      <main className="signin-main">
        <section className="signin-card" aria-labelledby="savegate-heading">
          <h1 id="savegate-heading">Save your report</h1>
          <p className="signin-sub">Create an account to keep this report and return to update it.</p>
          <div className="signin-draft" role="note" aria-label="Draft summary">
            {thumbUrl ? (
              <img className="signin-draft-thumb" src={thumbUrl} alt="" />
            ) : (
              <span className="signin-draft-thumb signin-draft-thumb-empty" aria-hidden="true" />
            )}
            <span className="signin-draft-text">
              <strong>{title}</strong>
              <span>Your photo and reviewed details are ready.</span>
            </span>
          </div>
          <div className="signin-gate-actions">
            <button type="button" className="signin-submit" onClick={() => onCreateAccount()}>
              Create account
            </button>
            <button type="button" className="signin-secondary" onClick={() => onSignIn()}>
              Sign in
            </button>
          </div>
          <p className="signin-switch">
            <button type="button" className="signin-text-button" onClick={onBackToReport}>
              Back to my report
            </button>
          </p>
          <p className="signin-footer">
            <button type="button" className="signin-text-button signin-footer-link" onClick={onPrivacyHelp}>
              Privacy &amp; help
            </button>
          </p>
        </section>
      </main>
    </div>
  );
}
