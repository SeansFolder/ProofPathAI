import React, { useEffect, useState } from 'react';
import { PRIVILEGE_CHOICES, api } from '../api.js';
import ConfirmDialog from './ConfirmDialog.jsx';
import './AdminAccounts.css';

const PERMISSION_ORDER = ['reports_view', 'reports_create', 'reports_edit', 'reports_status', 'reports_delete'];
const PERMISSION_SHORT = {
  reports_view: 'View',
  reports_create: 'create',
  reports_edit: 'edit',
  reports_status: 'status',
  reports_delete: 'delete',
};
const PERMISSION_DESCRIPTIONS = {
  reports_view: 'Read shared reports and open attached photos or videos.',
  reports_create: 'Upload evidence and prepare new community reports.',
  reports_edit: 'Change titles, categories, descriptions, and locations.',
  reports_status: 'Update the local Draft, Submitted, or Resolved label.',
  reports_delete: 'Permanently remove a report and its attached evidence.',
};

function privilegeSummary(privileges) {
  const selected = PERMISSION_ORDER.filter((item) => privileges.includes(item));
  if (selected.length === 1 && selected[0] === 'reports_view') return 'View reports';
  if (selected.length === 0) return 'No report access';
  return selected.map((item) => PERMISSION_SHORT[item]).join(' · ');
}

function initials(username) {
  const parts = username.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]).join('') || username.slice(0, 2);
  return letters.toUpperCase();
}

function PermissionOptions({ values, onToggle }) {
  return (
    <div className="accounts-permissions">
      <h2>Report permissions</h2>
      {PRIVILEGE_CHOICES.map(([value, label]) => (
        <label className="permission-option" key={value}>
          <input type="checkbox" checked={values.includes(value)} onChange={() => onToggle(value)} />
          <span>
            <strong>{label}</strong>
            <span>{PERMISSION_DESCRIPTIONS[value]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

function AccountsList({ accounts, onCreate, onManage }) {
  return (
    <>
      <div className="accounts-heading-row">
        <div>
          <p className="eyebrow">SUPER ADMIN</p>
          <h1>Admin accounts</h1>
          <p className="accounts-intro">Give each admin an individual sign-in and the report access they need.</p>
        </div>
        <button className="accounts-primary" type="button" onClick={onCreate}>
          Create admin
        </button>
      </div>
      <div className="accounts-toolbar">
        <p className="eyebrow">ADMIN ACCOUNTS</p>
        <span className="accounts-toolbar-note">Super admin access is managed separately.</span>
      </div>
      {accounts.length === 0 ? (
        <p className="accounts-empty">No admin accounts yet. Create the first account to get started.</p>
      ) : (
        <div className="accounts-list">
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span className="account-avatar" aria-hidden="true">
                {initials(account.username)}
              </span>
              <div className="account-identity">
                <h2>{account.username}</h2>
                <p>Admin</p>
              </div>
              <span className="account-summary">{privilegeSummary(account.privileges)}</span>
              <span className="account-pill">{account.active ? 'Active' : 'Disabled'}</span>
              <button type="button" className="accounts-outline-button" onClick={() => onManage(account.id)}>
                Manage
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="accounts-footnote">
        Disabling an account prevents sign-in and invalidates its current sessions. Reports remain in the shared workspace.
      </p>
    </>
  );
}

function CreateAdmin({ onCancel, onCreated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [privileges, setPrivileges] = useState(['reports_view']);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  function togglePrivilege(value) {
    setPrivileges((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setMessage('');
    setIsError(false);
    setBusy(true);
    try {
      const result = await api.createAdmin({ username: username.trim(), password, privileges, email: email.trim() });
      onCreated(result.username);
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Admin account could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="accounts-heading-row">
        <div>
          <p className="eyebrow">SUPER ADMIN / ADMIN ACCOUNTS</p>
          <h1>Create admin</h1>
          <p className="accounts-intro">Create an individual account. You can adjust its access later.</p>
        </div>
      </div>
      <div className="accounts-grid">
        <form className="accounts-card" onSubmit={onSubmit}>
          <div className="accounts-form-row">
            <div className="accounts-field">
              <label htmlFor="create-username">Username</label>
              <input
                id="create-username"
                name="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}"
                required
                autoComplete="off"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <p className="accounts-hint">3–32 characters: letters, digits, . _ -</p>
            </div>
            <div className="accounts-field">
              <label htmlFor="create-password">Temporary password</label>
              <input
                id="create-password"
                name="password"
                type="password"
                minLength={16}
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="accounts-hint">At least 16 characters.</p>
            </div>
          </div>
          <div className="accounts-field accounts-field-email">
            <label htmlFor="create-email">Email address (optional)</label>
            <input
              id="create-email"
              name="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="accounts-hint">Optional. This admin can sign in with it instead of their username.</p>
          </div>
          <PermissionOptions values={privileges} onToggle={togglePrivilege} />
          <div className="accounts-actions">
            <button className="accounts-primary" type="submit" disabled={busy}>
              Create admin
            </button>
            <button className="accounts-cancel" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
          {message && (
            <p className={`accounts-message${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>
              {message}
            </p>
          )}
        </form>
        <aside className="accounts-aside" aria-label="About admin access">
          <h2>Access starts with a clear role</h2>
          <p>This account will be an Admin. Only a Super admin can manage accounts.</p>
          <p>View reports is selected by default. Enable only the additional actions this person needs.</p>
          <p>Share the username and temporary password privately. The admin can change their own password after signing in.</p>
        </aside>
      </div>
    </>
  );
}

function ManageAdmin({ account, onCancel, onChanged }) {
  const [privileges, setPrivileges] = useState(account.privileges);
  const [email, setEmail] = useState(account.email || '');
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [confirmAccess, setConfirmAccess] = useState(false);

  function togglePrivilege(value) {
    setPrivileges((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function requestSave(event) {
    event.preventDefault();
    setConfirmAccess(true);
  }

  async function onSave() {
    setConfirmAccess(false);
    setMessage('');
    setIsError(false);
    setBusy(true);
    try {
      const updated = await api.updateAdmin(account.id, { privileges, email: email.trim() });
      onChanged(updated);
      setMessage('Access updated.');
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Account could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function onResetPassword(event) {
    event.preventDefault();
    setResetError('');
    setBusy(true);
    try {
      const updated = await api.updateAdmin(account.id, { password: resetPassword });
      onChanged(updated);
      setResetPassword('');
      setModal(null);
      setMessage('Password updated. Existing sessions were signed out.');
    } catch (error) {
      setResetError(error.message || 'Password could not be reset.');
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      const updated = await api.updateAdmin(account.id, { active: false });
      onChanged(updated);
      setModal(null);
      setMessage('Account disabled. The admin was signed out immediately.');
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Account could not be disabled.');
      setModal(null);
    } finally {
      setBusy(false);
    }
  }

  async function onEnable() {
    setMessage('');
    setIsError(false);
    setBusy(true);
    try {
      const updated = await api.updateAdmin(account.id, { active: true });
      onChanged(updated);
      setMessage('Account enabled.');
    } catch (error) {
      setIsError(true);
      setMessage(error.message || 'Account could not be enabled.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="accounts-heading-row">
        <div>
          <p className="eyebrow">SUPER ADMIN / ADMIN ACCOUNTS</p>
          <h1>Manage admin</h1>
          <p className="accounts-intro">Update report permissions, reset a password, or change account access.</p>
        </div>
      </div>
      <div className="accounts-grid">
        <form className="accounts-card" onSubmit={requestSave}>
          <div className="accounts-card-head">
            <h2>{account.username}</h2>
            <span className="account-pill">{account.active ? 'Active' : 'Disabled'}</span>
          </div>
          <div className="accounts-field accounts-field-email">
            <label htmlFor="manage-email">Email address (optional)</label>
            <input
              id="manage-email"
              name="email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="accounts-hint">Optional. This admin can sign in with it instead of their username.</p>
          </div>
          <PermissionOptions values={privileges} onToggle={togglePrivilege} />
          <div className="accounts-actions">
            <button className="accounts-primary" type="submit" disabled={busy}>
              Save changes
            </button>
            <button className="accounts-cancel" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
          {message && (
            <p className={`accounts-message${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>
              {message}
            </p>
          )}
        </form>
        <aside className="accounts-card accounts-access-card" aria-label="Sign-in and access">
          <h2>Sign-in and access</h2>
          <p>Reset a password when an admin needs help signing in.</p>
          <button type="button" className="accounts-outline-button" onClick={() => setModal('reset')}>
            Reset password
          </button>
          <p>Disabling access signs this admin out immediately. Their reports are kept.</p>
          {account.active ? (
            <button type="button" className="accounts-danger-link" disabled={busy} onClick={() => setModal('disable')}>
              Disable account
            </button>
          ) : (
            <button type="button" className="accounts-danger-link" disabled={busy} onClick={onEnable}>
              Enable account
            </button>
          )}
        </aside>
      </div>

      {confirmAccess && (
        <ConfirmDialog
          title={`Update access for ${account.username}?`}
          body="Permission and email changes take effect immediately and can change what this admin can see or do."
          confirmLabel="Save changes"
          safeLabel="Keep editing"
          busy={busy}
          busyLabel="Saving…"
          onConfirm={onSave}
          onClose={() => setConfirmAccess(false)}
        />
      )}

      {modal === 'disable' && (
        <Modal title={`Disable ${account.username}?`} onClose={() => setModal(null)}>
          <h2>Disable this admin?</h2>
          <p>
            The admin will be signed out immediately and will no longer be able to sign in. Their reports will remain in
            the shared workspace.
          </p>
          <p className="modal-username">{account.username}</p>
          <div className="modal-actions">
            <button type="button" className="modal-danger" disabled={busy} onClick={onDisable}>
              Disable account
            </button>
            <button type="button" className="accounts-outline-button" onClick={() => setModal(null)}>
              Keep enabled
            </button>
          </div>
        </Modal>
      )}

      {modal === 'reset' && (
        <Modal title={`Reset password for ${account.username}`} onClose={() => setModal(null)}>
          <h2>Reset admin password</h2>
          <p>Set a new password for this admin. Existing sessions will be signed out when you save.</p>
          <p className="modal-username">{account.username}</p>
          <form onSubmit={onResetPassword}>
            <div className="accounts-field">
              <label htmlFor="reset-password">New temporary password</label>
              <input
                id="reset-password"
                type="password"
                minLength={16}
                required
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
              />
              <p className="accounts-hint">Use at least 16 characters.</p>
            </div>
            {resetError && (
              <p className="accounts-message is-error" role="alert">
                {resetError}
              </p>
            )}
            <div className="modal-actions">
              <button className="accounts-primary" type="submit" disabled={busy}>
                Reset password
              </button>
              <button className="accounts-cancel" type="button" onClick={() => setModal(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function AdminPanel() {
  const [accounts, setAccounts] = useState([]);
  const [view, setView] = useState('accounts');
  const [manageId, setManageId] = useState(null);
  const [message, setMessage] = useState('');

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

  const managed = accounts.find((account) => account.id === manageId) || null;

  function updateAccount(updated) {
    setAccounts((current) => current.map((account) => (account.id === updated.id ? updated : account)));
  }

  return (
    <section className="journal" id="admin-panel">
      {message && (
        <p className="accounts-message is-error" role="alert">
          {message}
        </p>
      )}
      {view === 'accounts' && !managed && (
        <AccountsList accounts={accounts} onCreate={() => setView('create')} onManage={setManageId} />
      )}
      {view === 'create' && (
        <CreateAdmin
          onCancel={() => setView('accounts')}
          onCreated={() => {
            setView('accounts');
            load();
          }}
        />
      )}
      {managed && (
        <ManageAdmin
          key={managed.id}
          account={managed}
          onCancel={() => setManageId(null)}
          onChanged={updateAccount}
        />
      )}
    </section>
  );
}
