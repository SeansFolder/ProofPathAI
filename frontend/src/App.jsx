import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Topbar from './components/Topbar.jsx';
import Dashboard from './components/Dashboard.jsx';
import Wizard from './components/Wizard.jsx';
import SavedScreen from './components/SavedScreen.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import PasswordForm from './components/PasswordForm.jsx';

export default function App() {
  const [sessionUser, setSessionUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [reports, setReports] = useState([]);
  const [screen, setScreen] = useState('dashboard');
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [savedPreviewUrl, setSavedPreviewUrl] = useState(null);
  const [savedIsVideo, setSavedIsVideo] = useState(false);
  const [highlightId, setHighlightId] = useState(null);

  const hasPrivilege = (privilege) => sessionUser?.role === 'super_admin' || sessionUser?.privileges.includes(privilege);
  const isSuperAdmin = sessionUser?.role === 'super_admin';
  const canView = hasPrivilege('reports_view');
  const canCreate = hasPrivilege('reports_create');

  useEffect(() => {
    (async () => {
      let session;
      try {
        session = await api.session();
      } catch {
        window.location.assign('/login');
        return;
      }
      setSessionUser(session);
      setReady(true);
      const viewer = session.role === 'super_admin' || session.privileges.includes('reports_view');
      try {
        setAiStatus(await api.aiStatus());
      } catch {
        setAiStatus(null);
      }
      if (viewer) {
        try {
          setReports(await api.reports());
        } catch {
          setReports([]);
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (adminsOpen) {
      document.getElementById('admin-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [adminsOpen ]);

  useEffect(() => () => {
    if (savedPreviewUrl) URL.revokeObjectURL(savedPreviewUrl);
  }, [savedPreviewUrl]);

  async function refreshReports() {
    if (!canView) return;
    try {
      setReports(await api.reports());
    } catch {
      // api() already redirects on 401; other errors keep the current list.
    }
  }

  function showDashboard() {
    setScreen('dashboard');
    setAdminsOpen(false);
    refreshReports();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openWizard() {
    setAdminsOpen(false);
    setScreen('wizard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onSaved(report, file) {
    if (savedPreviewUrl) URL.revokeObjectURL(savedPreviewUrl);
    setLastSaved(report);
    setSavedIsVideo(file.type.startsWith('video/'));
    setSavedPreviewUrl(URL.createObjectURL(file));
    setScreen('saved');
    refreshReports();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onReviewSaved() {
    const id = lastSaved?.id;
    showDashboard();
    if (id) {
      setHighlightId(id);
      window.setTimeout(() => setHighlightId(null), 1600);
    }
  }

  function toggleAdmins() {
    setScreen('dashboard');
    setAdminsOpen((value) => !value);
  }

  if (!ready) return null;

  return (
    <>
      <Topbar
        sessionUser={sessionUser}
        isSuperAdmin={isSuperAdmin && screen === 'dashboard'}
        onShowReports={showDashboard}
        onToggleAdmins={toggleAdmins}
      />
      <main>
        {screen === 'dashboard' && (
          <>
            <Dashboard
              reports={reports}
              canView={canView}
              canCreate={canCreate}
              canEdit={hasPrivilege('reports_edit')}
              canStatus={hasPrivilege('reports_status')}
              canDelete={hasPrivilege('reports_delete')}
              highlightId={highlightId}
              onOpenWizard={openWizard}
              onUpdateReport={(updated) => setReports((current) => current.map((item) => (item.id === updated.id ? updated : item)))}
              onDeleteReport={(id) => setReports((current) => current.filter((item) => item.id !== id))}
            />
            {isSuperAdmin && adminsOpen && <AdminPanel />}
            <PasswordForm />
          </>
        )}
        {screen === 'wizard' && canCreate && <Wizard aiStatus={aiStatus} canCreate={canCreate} onSaved={onSaved} onCancel={showDashboard} />}
        {screen === 'saved' && lastSaved && (
          <SavedScreen
            report={lastSaved}
            previewUrl={savedPreviewUrl}
            isVideo={savedIsVideo}
            canStatus={hasPrivilege('reports_status')}
            onBack={showDashboard}
            onReview={onReviewSaved}
            onStatusUpdated={(updated) => {
              setLastSaved(updated);
              setReports((current) => current.map((item) => (item.id === updated.id ? updated : item)));
            }}
          />
        )}
      </main>
      <footer className="page-footer">
        <span>
          ProofPath AI <span className="footer-separator">/</span> Community reporting assistant
        </span>
        <span>AI suggestions are not official inspections.</span>
      </footer>
    </>
  );
}
