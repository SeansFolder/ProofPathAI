import React, { useEffect, useRef } from 'react';

// Account menu dropdown (handoff screen 15, reused for every role).
// Trigger is a profile avatar showing the first 2 letters of the username;
// the panel holds the full username, a per-role tag, and Sign out.
export function initialsFor(username) {
  const cleaned = String(username || '').trim();
  if (cleaned.length < 2) return (cleaned || '?').toUpperCase().padEnd(2, '·');
  return cleaned.slice(0, 2).toUpperCase();
}

const ROLE_LABELS = {
  super_admin: 'Super admin',
  admin: 'Admin',
  resident: 'Resident',
};

export function roleLabelFor(role) {
  return ROLE_LABELS[role] || 'Account';
}

export default function AccountMenu({ username, role, items = [], onSignOut, open, onToggle, onClose }) {
  const menuRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const firstItem = menuRef.current?.querySelector('button[role="menuitem"]');
    firstItem?.focus();
    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    function onPointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target) && !buttonRef.current?.contains(event.target)) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      buttonRef.current?.focus();
    };
  }, [open, onClose]);

  const label = roleLabelFor(role);

  return (
    <div className="acct-menu-wrap">
      <button
        ref={buttonRef}
        type="button"
        className="acct-avatar-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${username}`}
        title={username}
        onClick={onToggle}
      >
        <span className="acct-avatar" aria-hidden="true">{initialsFor(username)}</span>
        <span className="acct-caret" aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} className="acct-menu" role="menu" aria-label={`Account menu for ${username}`}>
          <div className="acct-identity" aria-hidden="true">
            <span className="acct-avatar" aria-hidden="true">{initialsFor(username)}</span>
            <span className="acct-identity-text">
              <strong className="acct-username">{username}</strong>
              <span className={`role-tag role-${role || 'unknown'}`}>{label}</span>
            </span>
          </div>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={item.onSelect}>
              {item.label}
            </button>
          ))}
          <button type="button" role="menuitem" className="acct-menu-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
