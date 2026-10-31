import React, { useState } from 'react';
import { api } from '../api.js';

export default function PasswordForm({ sessionUser, onBack }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage('');
    setOk(false);
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setOk(true);
      setMessage('Password updated. Other signed-in sessions have been signed out.');
    } catch (error) {
      setMessage(error?.message || 'Password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  const accountLine = sessionUser ? `${sessionUser.username} · ${sessionUser.role === 'super_admin' ? 'Super admin' : sessionUser.role === 'resident' ? 'Resident' : 'Admin'}` : '';

  return (
    <section className="w-flow m-password" aria-labelledby="password-heading">
      <p className="eyebrow">Your account</p>
      <h1 id="password-heading">Change password</h1>
      <p className="w-sub">Update the password for the account you are signed in to.</p>
      <form className="m-edit-card" onSubmit={onSubmit}>
        {accountLine && <p className="m-account-line">{accountLine}</p>}
        <label className="m-field">
          Current password
          <input
            name="current_password"
            type="password"
            required
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            aria-describedby="pw-current-hint"
          />
          <span className="m-hint" id="pw-current-hint">
            Enter your current password.
          </span>
        </label>
        <label className="m-field">
          New password
          <input
            name="new_password"
            type="password"
            minLength={16}
            required
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            aria-describedby="pw-new-hint"
          />
          <span className="m-hint" id="pw-new-hint">
            Use at least 16 characters.
          </span>
        </label>
        <p className={`w-form-error${ok ? ' is-ok' : ''}`} role="status">
          {message}
        </p>
        <div className="m-edit-actions">
          <button type="submit" className="w-primary" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
          <button type="button" className="w-link" onClick={onBack} disabled={busy}>
            Back to reports
          </button>
        </div>
      </form>
    </section>
  );
}
