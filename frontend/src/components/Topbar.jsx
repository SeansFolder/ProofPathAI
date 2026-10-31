import React, { useState } from 'react';
import logo from '../assets/logo.png';
import AccountMenu from './AccountMenu.jsx';

export default function Topbar({
  sessionUser,
  isSuperAdmin,
  adminActive,
  activeNav,
  onShowReports,
  onToggleAdmins,
  onOpenSettings,
  onSignOut,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isResident = sessionUser?.role === 'resident';

  // Centered text nav for the few pages per role; the current section
  // carries an underline, siblings are plain text links.
  const navLinks = isResident
    ? [
      { key: 'reports', label: 'Your reports', onSelect: onShowReports },
      { key: 'settings', label: 'Account settings', onSelect: onOpenSettings },
    ]
    : [
      { key: 'reports', label: 'Reports', onSelect: onShowReports },
      ...(isSuperAdmin ? [{ key: 'admins', label: 'Admin accounts', onSelect: onToggleAdmins }] : []),
    ];

  function closeMenu() {
    setMenuOpen(false);
  }

  async function handleMenuAction(action) {
    closeMenu();
    await action();
  }

  // The account menu mirrors this role's pages and closes on selection;
  // staff and admin actions stay in the top bar, never in a resident menu.
  // Dropdown holds identity + Sign out only; page links live in the
  // centered topbar nav (per confirmed header design).
  const menuItems = [];

  if (!sessionUser) {
    return (
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="ProofPath home"
          onClick={(event) => {
            event.preventDefault();
            onShowReports();
          }}
        >
          <img className="brand-lockup" src={logo} alt="ProofPath" />
        </a>
      </header>
    );
  }

  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        aria-label="ProofPath home"
        onClick={(event) => {
          event.preventDefault();
          onShowReports();
        }}
      >
        <img className="brand-lockup" src={logo} alt="ProofPath" />
      </a>
      <nav className="topbar-nav" aria-label="Sections">
        {navLinks.map((link) => (
          <button
            key={link.key}
            type="button"
            className={`topbar-nav-item${activeNav === link.key ? ' is-active' : ''}`}
            aria-current={activeNav === link.key ? 'page' : undefined}
            onClick={link.onSelect}
          >
            {link.label}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <AccountMenu
          username={sessionUser.username || ''}
          role={sessionUser.role || ''}
          open={menuOpen}
          onToggle={() => setMenuOpen((value) => !value)}
          items={menuItems}
          onSignOut={() => handleMenuAction(async () => onSignOut())}
          onClose={closeMenu}
        />
      </div>
    </header>
  );
}
