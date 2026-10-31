import React, { useState } from 'react';
import { api } from '../api.js';
import logo from '../assets/logo.png';

// Handoff screen 07: choose-a-new-password form. Consumes the single-use
// reset token once; invalid and expired links get distinct recovery copy.
export default function ResetPassword({ token, onReset, onBackHome, onPrivacyHelp, onRequestNewLink }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ password: '', confirm: '' });
  const [serverError, setServerError] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate() {
    const errors = {
      password: !password ? 'Enter a new password.' : password.length < 16 ? 'Use a password with at least 16 characters.' : '',
      confirm: !confirm ? 'Confirm your new password.' : confirm !== password ? 'Passwords do not match.' : '',
    };
    setFieldErrors(errors);
    return errors;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setServerError('');
    setExpired(false);
    const errors = validate();
    if (errors.password || errors.confirm) {
      // Focus the first invalid field in DOM order, deferred past the
      // re-render so the fresh invalid flags are in the DOM.
      const targetId = errors.password ? 'reset-new-password' : 'reset-confirm-password';
      window.setTimeout(() => document.getElementById(targetId)?.focus(), 0);
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      onReset();
    } catch (error) {
      const message = error?.message || 'This link could not be used. Request a new one.';
      setServerError(message);
      if (/expired/i.test(message)) setExpired(true);
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
        <section className="signin-card" aria-labelledby="reset-heading">
          <h1 id="reset-heading">Choose a new password</h1>
          <p className="signin-sub">Use a password with at least 16 characters that you have not used elsewhere.</p>
          {serverError && (
            <p className="signin-alert" role="alert">
              {serverError}
              {expired && onRequestNewLink && (
                <>
                  {' '}
                  <button type="button" className="signin-text-button" onClick={onRequestNewLink}>
                    Request a new link
                  </button>
                </>
              )}
            </p>
          )}
          <form className="signin-form" onSubmit={onSubmit} noValidate>
            <div className="signin-field">
              <label className="signin-label" htmlFor="reset-new-password">
                New password
              </label>
              <div className="signin-password-wrap">
                <input
                  id="reset-new-password"
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: '' })); }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'reset-new-password-error' : undefined}
                />
                <button
                  type="button"
                  className="signin-show"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {fieldErrors.password && (
                <p className="signin-inline-error" id="reset-new-password-error" role="alert">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <div className="signin-field">
              <label className="signin-label" htmlFor="reset-confirm-password">
                Confirm new password
              </label>
              <div className="signin-password-wrap">
                <input
                  id="reset-confirm-password"
                  name="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => { setConfirm(event.target.value); setFieldErrors((current) => ({ ...current, confirm: '' })); }}
                  aria-invalid={Boolean(fieldErrors.confirm)}
                  aria-describedby={fieldErrors.confirm ? 'reset-confirm-password-error' : undefined}
                />
                <button
                  type="button"
                  className="signin-show"
                  onClick={() => setShowConfirm((value) => !value)}
                  aria-pressed={showConfirm}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? 'Hide' : 'Show'}
                </button>
              </div>
              {fieldErrors.confirm && (
                <p className="signin-inline-error" id="reset-confirm-password-error" role="alert">
                  {fieldErrors.confirm}
                </p>
              )}
            </div>
            <button type="submit" className="signin-submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
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
