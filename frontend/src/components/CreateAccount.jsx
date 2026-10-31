import React, { useState } from 'react';
import { api } from '../api.js';
import { readAuthFields, writeAuthField } from '../draftStore.js';
import { FormBanner } from './FormFeedback.jsx';
import logo from '../assets/logo.png';

const USERNAME_HINT = 'Usernames must be 3–30 characters using letters, numbers, underscores, or periods, starting with a letter or number.';
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.]{2,29}$/;

// Resident create-account card covering handoff screen 04. Always creates a
// resident account via POST /api/residents; the backend ignores any role the
// caller might supply. On success the parent routes to the verify-email
// screen (09) instead of signing in directly. `notice` carries the
// create-gate message for signed-out report entry.
export default function CreateAccount({ initialEmail = '', notice = '', onCreated, onSignIn, onBackHome, onPrivacyHelp }) {
  // Non-sensitive fields (never the password) are remembered in session
  // storage so a Privacy & help round-trip does not wipe what was typed.
  const [email, setEmail] = useState(() => initialEmail || readAuthFields().signupEmail || '');
  const [username, setUsername] = useState(() => readAuthFields().signupUsername || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ email: '', username: '', password: '' });
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);

  function validate() {
    const trimmed = email.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const errors = {
      email: !trimmed ? 'Enter your email address.' : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? 'Enter a valid email address.' : '',
      username: !trimmedUsername ? 'Enter a username.' : !USERNAME_PATTERN.test(trimmedUsername) ? USERNAME_HINT : '',
      password: !password ? 'Enter a password.' : password.length < 16 ? 'Use a password with at least 16 characters.' : '',
    };
    setFieldErrors(errors);
    return !errors.email && !errors.username && !errors.password;
  }

  async function onSubmit(event) {
    event.preventDefault();
    setServerError('');
    if (!validate()) {
      // Focus the first invalid field (never color-only errors). Deferred
      // past the re-render so the fresh invalid flags are in the DOM.
      window.setTimeout(() => {
        document.querySelector('#resident-signup-username[aria-invalid="true"], #resident-signup-email[aria-invalid="true"], #resident-signup-password[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    setBusy(true);
    try {
      const created = await api.signup({ email: email.trim(), username: username.trim().toLowerCase(), password });
      onCreated(created);
    } catch (error) {
      // Keep every non-password value so the visitor never retypes them.
      setServerError(error?.message || 'This account could not be created. Try again.');
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
        <section className="signin-card" aria-labelledby="create-account-heading">
          <h1 id="create-account-heading">Create an account</h1>
          <p className="signin-sub">Save reports and return to follow up.</p>
          {notice && (
            <p className="signin-alert" role="status">
              {notice}
            </p>
          )}
          <FormBanner message={serverError} />
          <form className="signin-form" onSubmit={onSubmit} noValidate>
            <div className="signin-field">
              <label className="signin-label" htmlFor="resident-signup-username">
                Username
              </label>
              <input
                id="resident-signup-username"
                name="username"
                type="text"
                autoComplete="username"
                maxLength={30}
                value={username}
                onChange={(event) => { setUsername(event.target.value); writeAuthField('signupUsername', event.target.value); setFieldErrors((current) => ({ ...current, username: '' })); }}
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={fieldErrors.username ? 'resident-signup-username-error' : 'resident-signup-username-hint'}
              />
              {fieldErrors.username ? (
                <p className="signin-inline-error" id="resident-signup-username-error" role="alert">
                  {fieldErrors.username}
                </p>
              ) : (
                <p className="signin-hint" id="resident-signup-username-hint">
                  {USERNAME_HINT}
                </p>
              )}
            </div>
            <div className="signin-field">
              <label className="signin-label" htmlFor="resident-signup-email">
                Email address
              </label>
              <input
                id="resident-signup-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); writeAuthField('signupEmail', event.target.value); setFieldErrors((current) => ({ ...current, email: '' })); }}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'resident-signup-email-error' : undefined}
              />
              {fieldErrors.email && (
                <p className="signin-inline-error" id="resident-signup-email-error" role="alert">
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <div className="signin-field">
              <label className="signin-label" htmlFor="resident-signup-password">
                Password
              </label>
              <div className="signin-password-wrap">
                <input
                  id="resident-signup-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: '' })); }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'resident-signup-password-error' : 'resident-signup-password-hint'}
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
              {fieldErrors.password ? (
                <p className="signin-inline-error" id="resident-signup-password-error" role="alert">
                  {fieldErrors.password}
                </p>
              ) : (
                <p className="signin-hint" id="resident-signup-password-hint">
                  Use a password with at least 16 characters.
                </p>
              )}
            </div>
            <button type="submit" className="signin-submit" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>
          <p className="signin-switch">
            Already have an account?{' '}
            <button type="button" className="signin-text-button" onClick={() => onSignIn()}>
              Sign in
            </button>
          </p>
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
