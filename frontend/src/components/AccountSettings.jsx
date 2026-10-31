import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const USERNAME_HINT = 'Usernames must be 3–30 characters using letters, numbers, underscores, or periods, starting with a letter or number.';
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.]{2,29}$/;

// Handoff screens 11 (account settings) and 14 (changes-saved state of the
// same screen). Profile edits persist through PATCH /api/account; the saved
// banner renders only after persistence succeeds. Password changes reuse the
// existing POST /api/account/password flow via the Change-password screen.
// Legacy residents whose username is still their email choose a username here.
export default function AccountSettings({
  sessionUser,
  savedFlash,
  onSaved,
  onChangePassword,
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [needsUsername, setNeedsUsername] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ displayName: '', email: '', username: '' });
  const [serverError, setServerError] = useState('');
  const [verifyNotice, setVerifyNotice] = useState('');
  const [busy, setBusy] = useState(false);
  // Last persisted identity, to detect username/email changes that need
  // explicit confirmation before saving.
  const [savedIdentity, setSavedIdentity] = useState({ username: '', email: '' });
  const [confirmIdentity, setConfirmIdentity] = useState(null);
  const pendingPayloadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const account = await api.getAccount();
        if (!cancelled) {
          setDisplayName(account?.display_name || '');
          setEmail(account?.email || '');
          setUsername(account?.username || '');
          setSavedIdentity({
            username: (account?.username || '').trim().toLowerCase(),
            email: (account?.email || '').trim(),
          });
          setNeedsUsername(Boolean(account?.needs_username));
          setLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          setServerError(error?.message || 'Your account details could not be loaded.');
          setLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isResident = sessionUser?.role === 'resident';

  async function onSubmit(event) {
    event.preventDefault();
    setServerError('');
    setVerifyNotice('');
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const errors = {
      displayName: trimmedName.length > 60 ? 'Display name must be 60 characters or fewer.' : '',
      email: !trimmedEmail
        ? 'Enter your email address.'
        : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmedEmail)
          ? 'Enter a valid email address.'
          : '',
      username: '',
    };
    if (isResident && (needsUsername || trimmedUsername)) {
      if (!trimmedUsername) errors.username = 'Enter a username.';
      else if (!USERNAME_PATTERN.test(trimmedUsername)) errors.username = USERNAME_HINT;
    }
    setFieldErrors(errors);
    if (errors.displayName || errors.email || errors.username) {
      // Deferred past the re-render so the fresh invalid flags are in the DOM.
      window.setTimeout(() => {
        document.querySelector('#acct-username[aria-invalid="true"], #acct-display-name[aria-invalid="true"], #acct-email[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    // Username or email changes alter sign-in identity (and an email change
    // requires re-verification), so they need explicit confirmation first.
    // A display-name-only edit saves immediately.
    const usernameChanged = isResident && trimmedUsername && trimmedUsername !== savedIdentity.username;
    const emailChanged = trimmedEmail && trimmedEmail !== savedIdentity.email;
    if (usernameChanged || emailChanged) {
      pendingPayloadRef.current = { display_name: trimmedName, email: trimmedEmail, ...(isResident && trimmedUsername ? { username: trimmedUsername } : {}) };
      setConfirmIdentity({ usernameChanged, emailChanged });
      return;
    }
    await doSave({ display_name: trimmedName, email: trimmedEmail, ...(isResident && trimmedUsername ? { username: trimmedUsername } : {}) });
  }

  async function doSave(payload) {
    setConfirmIdentity(false);
    setBusy(true);
    try {
      const updated = await api.updateAccount(payload);
      setDisplayName(updated?.display_name || '');
      setEmail(updated?.email || '');
      if (updated?.username) setUsername(updated.username);
      setSavedIdentity({
        username: (updated?.username || '').trim().toLowerCase(),
        email: (updated?.email || '').trim(),
      });
      setNeedsUsername(Boolean(updated?.needs_username));
      if (updated?.verification_required) {
        setVerifyNotice('Confirm your new email address with the link we just sent before signing in again.');
      }
      onSaved();
    } catch (error) {
      setServerError(error?.message || 'Your changes could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="acct" aria-labelledby="acct-heading">
      <h1 id="acct-heading">Account settings</h1>
      <p className="acct-sub">Manage your profile and sign-in details.</p>
      {savedFlash && (
        <p className="acct-saved" role="status">
          <strong>Changes saved</strong>
          <span>Your account details have been updated.</span>
        </p>
      )}
      {serverError && (
        <p className="signin-alert" role="alert">
          {serverError}
        </p>
      )}
      {verifyNotice && (
        <p className="signin-alert signin-alert-success" role="status">
          {verifyNotice}
        </p>
      )}
      <form className="acct-card" onSubmit={onSubmit} noValidate aria-label="Profile">
        <h2>Profile</h2>
        {isResident && (
          <div className="acct-field">
            <label className="signin-label" htmlFor="acct-username">
              Username
            </label>
            <input
              id="acct-username"
              name="username"
              type="text"
              autoComplete="username"
              maxLength={30}
              value={username}
              disabled={!loaded}
              onChange={(event) => { setUsername(event.target.value); setFieldErrors((current) => ({ ...current, username: '' })); }}
              aria-invalid={Boolean(fieldErrors.username)}
              aria-describedby={fieldErrors.username ? 'acct-username-error' : 'acct-username-hint'}
            />
            {fieldErrors.username ? (
              <p className="signin-inline-error" id="acct-username-error" role="alert">
                {fieldErrors.username}
              </p>
            ) : (
              <p className="signin-hint" id="acct-username-hint">
                {needsUsername ? 'Choose a username for your account. ' : 'Sign in with this username or your email address. '}
                {USERNAME_HINT}
              </p>
            )}
          </div>
        )}
        <div className="acct-field">
          <label className="signin-label" htmlFor="acct-display-name">
            Display name (optional)
          </label>
          <input
            id="acct-display-name"
            name="display-name"
            type="text"
            autoComplete="nickname"
            maxLength={60}
            value={displayName}
            disabled={!loaded}
            onChange={(event) => { setDisplayName(event.target.value); setFieldErrors((current) => ({ ...current, displayName: '' })); }}
            aria-invalid={Boolean(fieldErrors.displayName)}
            aria-describedby={fieldErrors.displayName ? 'acct-display-name-error' : undefined}
          />
          {fieldErrors.displayName && (
            <p className="signin-inline-error" id="acct-display-name-error" role="alert">
              {fieldErrors.displayName}
            </p>
          )}
        </div>
        <div className="acct-field">
          <label className="signin-label" htmlFor="acct-email">
            Email address
          </label>
          <input
            id="acct-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            disabled={!loaded}
            onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: '' })); }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'acct-email-error' : undefined}
          />
          {fieldErrors.email && (
            <p className="signin-inline-error" id="acct-email-error" role="alert">
              {fieldErrors.email}
            </p>
          )}
        </div>
        <button type="submit" className="acct-save" disabled={busy || !loaded}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
      <div className="acct-card acct-row">
        <div>
          <h2>Password</h2>
          <p>Update the password used to sign in.</p>
        </div>
        <button type="button" className="acct-outline" onClick={onChangePassword}>
          Change password
        </button>
      </div>
      {confirmIdentity && (
        <ConfirmDialog
          title="Save these account changes?"
          body={
            confirmIdentity.emailChanged
              ? 'Your email address identifies your account and a new address needs confirmation before you sign in again.'
              : 'Your username is part of how you sign in.'
          }
          detail="These changes take effect immediately."
          confirmLabel="Save changes"
          safeLabel="Keep editing"
          busy={busy}
          busyLabel="Saving…"
          onConfirm={() => doSave(pendingPayloadRef.current || {})}
          onClose={() => { setConfirmIdentity(null); pendingPayloadRef.current = null; }}
        />
      )}
    </section>
  );
}
