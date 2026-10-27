import React, { useEffect, useState } from 'react';
import { PRIVILEGE_CHOICES, api } from '../api.js';

function AccountCard({ account }) {
  const [active, setActive] = useState(account.active);
  const [privileges, setPrivileges] = useState(account.privileges);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function togglePrivilege(value) {
    setPrivileges((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const payload = { active, privileges };
    if (password) payload.password = password;
    try {
      await api.updateAdmin(account.id, payload);
      setMessage('Account updated.');
      setPassword('');
    } catch (error) {
      setMessage(error.message || 'Account could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-account-card" onSubmit={onSubmit}>
      <h3>{account.username}</h3>
      <label>
        <input type="checkbox" name="active" checked={active} onChange={(event) => setActive(event.target.checked)} /> Account enabled
      </label>
      <fieldset className="privilege-options account-privileges">
        <legend>Report privileges</legend>
        {PRIVILEGE_CHOICES.map(([value, label]) => (
          <label key={value}>
            <input type="checkbox" name="privileges" value={value} checked={privileges.includes(value)} onChange={() => togglePrivilege(value)} /> {label}
          </label>
        ))}
      </fieldset>
      <label>
        Set a new password (optional)
        <input type="password" name="password" minLength={16} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Save account
      </button>
      <p className="admin-form-message">{message}</p>
    </form>
  );
}

export default function AdminPanel() {
  const [accounts, setAccounts] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privileges, setPrivileges] = useState(['reports_view']);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setAccounts(await api.admins());
    } catch (error) {
      setMessage(error.message || 'Could not load admin accounts.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function togglePrivilege(value) {
    setPrivileges((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  async function onCreate(event) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      const result = await api.createAdmin({ username: username.trim(), password, privileges });
      setUsername('');
      setPassword('');
      setPrivileges(['reports_view']);
      setMessage(`Created admin account ${result.username}.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Admin account could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" id="admin-panel" aria-labelledby="admin-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SUPER ADMIN</p>
          <h2 id="admin-heading">Manage admin accounts</h2>
        </div>
      </div>
      <p className="admin-help">
        Each admin has an individual sign-in. Choose exactly which report actions they can use. Only a super admin can manage accounts.
      </p>
      <form className="admin-create-form" onSubmit={onCreate}>
        <label>
          Username
          <input name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" required autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Temporary password
          <input name="password" type="password" minLength={16} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <fieldset className="privilege-options">
          <legend>Privileges</legend>
          {PRIVILEGE_CHOICES.map(([value, label]) => (
            <label key={value}>
              <input type="checkbox" name="privileges" value={value} checked={privileges.includes(value)} onChange={() => togglePrivilege(value)} /> {label}
            </label>
          ))}
        </fieldset>
        <button className="submit-button" type="submit" disabled={busy}>
          Create admin
        </button>
        <p className="admin-form-message" role="status">
          {message}
        </p>
      </form>
      <div className="admin-account-list" aria-live="polite">
        {accounts.length === 0 && <p>No normal admin accounts yet.</p>}
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} />
        ))}
      </div>
    </section>
  );
}
