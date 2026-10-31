import React from 'react';
import logo from '../assets/logo.png';

// Handoff screen 12: privacy & help explainer. Copy matches the reference:
// AI suggestions need human review, privacy stays under the user's control,
// and saving a report does not send it to an agency.
export default function PrivacyHelp({ onCreateReport, onBackHome, backLabel = 'Back to home' }) {
  return (
    <div className="signin">
      <header className="signin-header">
        <div className="signin-header-inner">
          <a href="/" aria-label="ProofPath home" onClick={(event) => { event.preventDefault(); onBackHome(); }}>
            <img className="brand-lockup" src={logo} alt="ProofPath" />
          </a>
          <button type="button" className="signin-back" onClick={onBackHome}>
            {backLabel}
          </button>
        </div>
      </header>
      <main className="signin-main signin-main-wide">
        <section className="signin-card" aria-labelledby="privacy-heading">
          <h1 id="privacy-heading">Privacy &amp; reporting</h1>
          <p className="signin-sub">A few things to know before you create or share a report.</p>
          <h2 className="signin-h2">What ProofPath AI does</h2>
          <p className="signin-p">
            ProofPath AI helps you organize visual evidence, review suggested observations, and create a written
            record of a community issue.
          </p>
          <h2 className="signin-h2">Your review matters</h2>
          <p className="signin-p">
            Confirm the location and visible details yourself. Keep uncertain causes, measurements, or severity
            out of the report.
          </p>
          <h2 className="signin-h2">Before you share</h2>
          <p className="signin-p">
            Review the photo for personal details. Use metadata removal and blurring controls where needed, and
            include only information you intend to share.
          </p>
          <h2 className="signin-h2">Saving, sending, and tracking</h2>
          <p className="signin-p">
            Saving keeps a report in your workspace. Deliver it through the appropriate organization&rsquo;s
            channel, then update its status in ProofPath AI.
          </p>
          <div className="signin-privacy-actions">
            <button type="button" className="signin-cta" onClick={onCreateReport}>
              Create a report
            </button>
            <button type="button" className="signin-text-button" onClick={onBackHome}>
              {backLabel}
            </button>
          </div>
          <p className="signin-footer">
            <span className="signin-footer-muted">Privacy &amp; help</span>
          </p>
        </section>
      </main>
    </div>
  );
}
