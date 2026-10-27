import React from 'react';

export default function Topbar({ sessionUser, isSuperAdmin, onShowReports, onToggleAdmins }) {
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
        <span className="brand-mark" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
        <span>
          proofpath<span className="brand-ai">AI</span>
        </span>
      </a>
      <nav className="topbar-right" aria-label="Account navigation">
        <a
          className="nav-current"
          href="#dashboard"
          onClick={(event) => {
            event.preventDefault();
            onShowReports();
          }}
        >
          Your reports
        </a>
        {isSuperAdmin && (
          <a
            className="text-link"
            href="#admin-panel"
            onClick={(event) => {
              event.preventDefault();
              onToggleAdmins();
            }}
          >
            Admin accounts
          </a>
        )}
        <span className="signed-in-as">
          {sessionUser ? `${sessionUser.username} · ${sessionUser.role === 'super_admin' ? 'Super admin' : 'Admin'}` : ''}
        </span>
        <form action="/logout" method="post">
          <button className="text-link logout-button" type="submit">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
