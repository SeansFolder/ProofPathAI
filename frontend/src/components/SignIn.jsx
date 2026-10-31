import React, { useState } from 'react';
import { api } from '../api.js';
import { readAuthFields, writeAuthField } from '../draftStore.js';
import { FormBanner } from './FormFeedback.jsx';
import logo from '../assets/logo.png';

const GENERIC_FAILURE = 'The email address, username, or password is incorrect.';

// Resident sign-in card covering handoff screens 03 (sign-in) and 13
// (sign-in validation error state). Accepts an email address or username in
// one identifier field (case-insensitive per account rules). onCreateAccount
// opens screen 04, onForgotPassword opens the screen 05 recovery flow, and
// onPrivacyHelp opens screen 12.
export default function SignIn({ notice = '', onSuccess, onBackHome, onCreateAccount, onForgotPassword, onPrivacyHelp }) {
  // The identifier (never the password) is remembered in session storage so
  // a Privacy & help round-trip does not wipe what was typed.
  const [identifier, setIdentifier] = useState(() => readAuthFields().signinIdentifier || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ identifier: '', password: '' });
  const [serverError, setServerError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasErrors = Boolean(fieldErrors.identifier || fieldErrors.password || serverError);

  function validate() {
    const errors = {
      identifier: identifier.trim() ? '' : 'Enter your email address or username.',
      password: password ? '' : 'Enter your password.',
    };
    setFieldErrors(errors);
    return !errors.identifier && !errors.password;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setServerError('');
    if (!validate()) {
      setAttempted(true);
      // Defer past the re-render: state updates above have not committed yet,
      // so querying synchronously can miss the freshly invalid field.
      window.setTimeout(() => {
        document.querySelector('#resident-signin-identifier[aria-invalid="true"], #resident-signin-password[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    setBusy(true);
    try {
      const session = await api.login({ username: identifier.trim(), password });
      onSuccess(session);
    } catch (error) {
      setServerError(error?.message || GENERIC_FAILURE);
      setAttempted(true);
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
        <section className="signin-card" aria-labelledby="signin-heading">
          {hasErrors ? (
            <>
              <h1 id="signin-heading">Sign in</h1>
              <p className="signin-sub">Enter your email address or username and password to continue.</p>
            </>
          ) : (
            <>
              <h1 id="signin-heading">Welcome back</h1>
              <p className="signin-sub">Sign in to manage your reports.</p>
            </>
          )}
          <FormBanner message={serverError} />
          {notice && !serverError && (
            <p className="signin-note" role="status">
              {notice}
            </p>
          )}
          <form className="signin-form" onSubmit={onSubmit} noValidate>
            <div className="signin-field">
              <label className="signin-label" htmlFor="resident-signin-identifier">
                Email address or username
              </label>
              <input
                id="resident-signin-identifier"
                name="username"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(event) => { setIdentifier(event.target.value); writeAuthField('signinIdentifier', event.target.value); setFieldErrors((current) => ({ ...current, identifier: '' })); }}
                aria-invalid={Boolean(fieldErrors.identifier)}
                aria-describedby={fieldErrors.identifier ? 'resident-signin-identifier-error' : undefined}
              />
              {fieldErrors.identifier && (
                <p className="signin-inline-error" id="resident-signin-identifier-error" role="alert">
                  {fieldErrors.identifier}
                </p>
              )}
            </div>
            <div className="signin-field">
              <label className="signin-label" htmlFor="resident-signin-password">
                Password
              </label>
              <div className="signin-password-wrap">
                <input
                  id="resident-signin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: '' })); }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'resident-signin-password-error' : undefined}
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
                <p className="signin-inline-error" id="resident-signin-password-error" role="alert">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <p className="signin-forgot">
              {onForgotPassword ? (
                <button type="button" className="signin-text-button" onClick={() => onForgotPassword()}>
                  Forgot password?
                </button>
              ) : (
                <a href="/forgot-password">Forgot password?</a>
              )}
            </p>
            <button type="submit" className="signin-submit" disabled={busy}>
              {busy ? 'Signing in…' : attempted ? 'Try again' : 'Sign in'}
            </button>
          </form>
          <p className="signin-switch">
            New to ProofPath?{' '}
            {onCreateAccount ? (
              <button type="button" className="signin-text-button" onClick={() => onCreateAccount()}>
                Create account
              </button>
            ) : (
              <span>Create account</span>
            )}
          </p>
          <p className="signin-footer">
            {onPrivacyHelp ? (
              <button type="button" className="signin-text-button signin-footer-link" onClick={onPrivacyHelp}>
                Privacy &amp; help
              </button>
            ) : (
              <a href="#privacy">Privacy &amp; help</a>
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
