import React, { useState } from 'react';
import { api } from '../api.js';
import { readAuthFields, writeAuthField } from '../draftStore.js';
import logo from '../assets/logo.png';

// Handoff screen 05: recover-password form. The request endpoint always
// returns the generic 06 copy, so this screen routes to the sent notice
// without revealing whether the address has an account.
export default function RecoverPassword({ initialEmail = '', onSent, onBackSignIn, onBackHome, onPrivacyHelp }) {
  // The typed address (never a password) survives a Privacy & help detour.
  const [email, setEmail] = useState(() => initialEmail || readAuthFields().recoverEmail || '');
  const [fieldError, setFieldError] = useState('');
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setServerError('');
    const trimmed = email.trim();
    if (!trimmed) {
      setFieldError('Enter your email address.');
      // Defer past the re-render so the error node exists before focusing.
      window.setTimeout(() => document.getElementById('recover-email')?.focus(), 0);
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setFieldError('Enter a valid email address.');
      window.setTimeout(() => document.getElementById('recover-email')?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      await api.requestPasswordReset(trimmed);
      onSent(trimmed);
    } catch (error) {
      setServerError(error?.message || 'This request could not be completed. Try again.');
    } finally {
      setBusy(false);
    }
  }

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
        <section className="signin-card" aria-labelledby="recover-heading">
          <h1 id="recover-heading">Reset your password</h1>
          <p className="signin-sub">Password recovery uses your email address. Enter the email address you use for ProofPath AI.</p>
          {serverError && (
            <p className="signin-alert" role="alert">
              {serverError}
            </p>
          )}
          <form className="signin-form" onSubmit={onSubmit} noValidate>
            <div className="signin-field">
              <label className="signin-label" htmlFor="recover-email">
                Email address
              </label>
              <input
                id="recover-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); writeAuthField('recoverEmail', event.target.value); setFieldError(''); }}
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'recover-email-error' : undefined}
              />
              {fieldError && (
                <p className="signin-inline-error" id="recover-email-error" role="alert">
                  {fieldError}
                </p>
              )}
            </div>
            <button type="submit" className="signin-submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p className="signin-switch">
            <button type="button" className="signin-text-button" onClick={() => onBackSignIn()}>
              Back to sign in
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
