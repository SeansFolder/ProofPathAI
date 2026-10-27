import React, { useState } from 'react';
import { api } from '../api.js';

export default function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      await api.changePassword({ current_password: current, new_password: next });
      setCurrent('');
      setNext('');
      setMessage('Password updated. Other signed-in sessions have been signed out.');
    } catch (error) {
      setMessage(error.message || 'Password could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="account-settings">
      <summary>Change my password</summary>
      <form className="password-change-form" onSubmit={onSubmit}>
        <label>
          Current password
          <input name="current_password" type="password" required autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </label>
        <label>
          New password (16 characters minimum)
          <input name="new_password" type="password" minLength={16} required autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>
          Update password
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}
