import React, { useState } from 'react';
import { api } from '../api.js';
import logo from '../assets/logo.png';

// Verify-email screen covering handoff screen 09: check-email notice with
// confirmation-link result, resend confirmation, and use-a-different-email
// actions. Token consumption lives in the parent (App): the token is
// submitted once per verification attempt, independently of this component
// mounting, so navigating away and back never resubmits a consumed token.
// `status` is one of 'pending', 'verifying', 'verified', or 'invalid';
// `errorMessage` carries the invalid/expired-link copy. `initialToken` is
// accepted for backwards compatibility but never submitted from here.
// `devPreviewUrl` is shown only right after signup, while no email delivery
// service is configured; the resend path stays generic and reveals nothing.
export default function VerifyEmail({ email = '', initialToken = '', status = 'pending', errorMessage = '', devPreviewUrl = '', onContinueSignIn, onUseDifferentEmail, onBackHome, onPrivacyHelp }) {
  void initialToken;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const displayError = error || errorMessage;

  async function onResend() {
    setNotice('');
    setError('');
    setBusy(true);
    try {
      const result = await api.resendVerification(email);
      setNotice(result?.detail || 'If that address has a pending confirmation, a new link is on its way.');
    } catch (err) {
      setError(err?.message || 'This request could not be completed. Try again.');
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
        <section className="signin-card" aria-labelledby="verify-heading" aria-live="polite">
          <h1 id="verify-heading">Check your email</h1>
          {status === 'verified' ? (
            <>
              <p className="signin-sub">Confirm your email to finish setting up your account.</p>
              <p className="signin-alert signin-alert-success" role="status">
                Your email is confirmed. Continue to sign in.
              </p>
              <button type="button" className="signin-submit" onClick={() => onContinueSignIn()}>
                Continue to sign in
              </button>
            </>
          ) : (
            <>
              <p className="signin-sub">
                Open the confirmation link in your email{email ? <> for <strong>{email}</strong></> : null}, then return to sign in.
              </p>
              {status === 'verifying' && <p className="signin-sub">Confirming your link…</p>}
              {displayError && (
                <p className="signin-alert" role="alert">
                  {displayError}
                </p>
              )}
              {notice && (
                <p className="signin-alert signin-alert-success" role="status">
                  {notice}
                </p>
              )}
              {devPreviewUrl && status === 'pending' && (
                <p className="signin-devbox" role="note">
                  Development preview — no email service is configured yet. Use this link to verify:{' '}
                  <a href={devPreviewUrl}>{devPreviewUrl}</a>
                </p>
              )}
              <button type="button" className="signin-submit" onClick={() => onContinueSignIn()}>
                Continue to sign in
              </button>
              <p className="signin-switch">
                <button type="button" className="signin-text-button" onClick={onResend} disabled={busy || !email}>
                  {busy ? 'Sending…' : 'Resend confirmation'}
                </button>
              </p>
              <p className="signin-switch">
                <button type="button" className="signin-text-button" onClick={onUseDifferentEmail}>
                  Use a different email
                </button>
              </p>
            </>
          )}
          <p className="signin-footer">
            {onPrivacyHelp ? (
              <button type="button" className="signin-text-button signin-footer-link" onClick={onPrivacyHelp}>
                Privacy &amp; help
              </button>
            ) : (
              <a href="/privacy-help" onClick={(event) => event.preventDefault()}>
                Privacy &amp; help
              </a>
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
