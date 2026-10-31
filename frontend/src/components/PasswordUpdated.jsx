import React from 'react';
import logo from '../assets/logo.png';

// Handoff screen 08: password-updated confirmation. Returns the resident
// to the sign-in screen (03).
export default function PasswordUpdated({ onSignIn, onBackHome, onPrivacyHelp }) {
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
        <section className="signin-card" aria-labelledby="updated-heading">
          <h1 id="updated-heading">Password updated</h1>
          <p className="signin-sub">You can now sign in with your new password.</p>
          <p className="signin-checkline" role="status">
            <span aria-hidden="true">✓</span> Your account is ready for you to sign in.
          </p>
          <button type="button" className="signin-submit" onClick={() => onSignIn()}>
            Sign in
          </button>
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
