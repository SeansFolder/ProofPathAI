import React from 'react';
import logo from '../assets/logo.png';

// Handoff screen 06: reset-link-sent confirmation. The copy is generic by
// design: it must not confirm whether a particular email has an account.
export default function ResetLinkSent({ onBackSignIn, onUseDifferentEmail, onBackHome, onPrivacyHelp }) {
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
        <section className="signin-card" aria-labelledby="reset-sent-heading">
          <h1 id="reset-sent-heading">Check your inbox</h1>
          <p className="signin-sub">If an account matches that address, a password reset link will arrive shortly.</p>
          <div className="signin-notebox" role="note">
            <p className="signin-notebox-title">Use the link in your email</p>
            <p className="signin-notebox-text">The link opens a page where you can choose a new password.</p>
          </div>
          <button type="button" className="signin-submit" onClick={() => onBackSignIn()}>
            Back to sign in
          </button>
          <p className="signin-switch">
            <button type="button" className="signin-text-button" onClick={onUseDifferentEmail}>
              Use a different email
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
