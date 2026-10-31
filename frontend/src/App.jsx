import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { clearPendingDraft, clearPostAuth, loadPendingDraft, markDraftScreen, readDraftOwner, readDraftScreen, readPostAuth, savePendingDraft, savePostAuth } from './draftStore.js';
import { clearNavRestore, clearVerifyResult, isProtectedScreen, privacyBackLabel, readHistoryNav, readNavRestore, readVerifyResult, sanitizeHistoryState, saveNavRestore, saveVerifyResult, shouldAttemptVerify } from './navState.js';

const CREATE_GATE_NOTICE = 'Create an account to save and manage your reports.';
const SESSION_EXPIRED_NOTICE = 'Your session expired. Please sign in to continue.';
import Topbar from './components/Topbar.jsx';
import Homepage from './components/Homepage.jsx';
import SignIn from './components/SignIn.jsx';
import CreateAccount from './components/CreateAccount.jsx';
import VerifyEmail from './components/VerifyEmail.jsx';
import RecoverPassword from './components/RecoverPassword.jsx';
import ResetLinkSent from './components/ResetLinkSent.jsx';
import ResetPassword from './components/ResetPassword.jsx';
import PasswordUpdated from './components/PasswordUpdated.jsx';
import YourReports from './components/YourReports.jsx';
import SaveReportGate from './components/SaveReportGate.jsx';
import AccountSettings from './components/AccountSettings.jsx';
import PrivacyHelp from './components/PrivacyHelp.jsx';
import Dashboard from './components/Dashboard.jsx';
import Wizard from './components/Wizard.jsx';
import SavedScreen from './components/SavedScreen.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import PasswordForm from './components/PasswordForm.jsx';
import ReportDetails from './components/ReportDetails.jsx';
import ReportEdit from './components/ReportEdit.jsx';
import StatusDialog from './components/StatusDialog.jsx';
import DeleteDialog from './components/DeleteDialog.jsx';
import ReportDelivery from './components/ReportDelivery.jsx';
import PdfPreview from './components/PdfPreview.jsx';

export default function App() {
  const [sessionUser, setSessionUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [reports, setReports] = useState([]);
  const [screen, setScreen] = useState('homepage');
  const [wizardCategory, setWizardCategory] = useState('');
  const [adminsOpen, setAdminsOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [savedPreviewUrl, setSavedPreviewUrl] = useState(null);
  const [savedIsVideo, setSavedIsVideo] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailState, setDetailState] = useState('idle');
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [devPreviewUrl, setDevPreviewUrl] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [pendingDraft, setPendingDraft] = useState(null);
  const [pwdReturn, setPwdReturn] = useState('dashboard');
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [postAuth, setPostAuth] = useState(null);
  const [privacyReturn, setPrivacyReturn] = useState('');
  const [reportsError, setReportsError] = useState(false);
  // Verification outcome owned by App (not the VerifyEmail mount), so a
  // consumed token is never resubmitted when navigating away and back.
  // The raw token lives only in memory and is cleared after one attempt.
  const [verifyStatus, setVerifyStatus] = useState('pending');
  const [verifyError, setVerifyError] = useState('');
  const verifyAttemptRef = useRef('');
  // Live session mirror for the popstate handler, which cannot await state.
  const sessionUserRef = useRef(sessionUser);
  sessionUserRef.current = sessionUser;
  // History-sync bookkeeping: last pushed entry (loop/dup guard),
  // pop-driven updates (skip re-push), and stack depth for in-app Back.
  const navSyncRef = useRef({ lastPushed: '', applyingPop: false, depth: 0 });

  const hasPrivilege = (privilege) => sessionUser?.role === 'super_admin' || sessionUser?.privileges.includes(privilege);
  const isSuperAdmin = sessionUser?.role === 'super_admin';
  // Residents act only on their own reports; the backend enforces ownership.
  const isResident = sessionUser?.role === 'resident';
  const canView = hasPrivilege('reports_view') || isResident;
  const canCreate = hasPrivilege('reports_create') || isResident;
  const canEdit = hasPrivilege('reports_edit') || isResident;
  const canStatus = hasPrivilege('reports_status') || isResident;
  const canDelete = hasPrivilege('reports_delete');

  useEffect(() => {
    (async () => {
      // A confirmation-link visit (/?verify=token) goes straight to the
      // verify-email screen, which consumes the token once. A reset-link
      // visit (/?reset=token) opens the choose-a-new-password screen.
      // A stored guest draft survives these full-page visits and is claimed
      // after sign-in; a stored in-flow screen resumes the wizard directly.
      const params = new URLSearchParams(window.location.search);
      const verify = params.get('verify');
      const reset = params.get('reset');
      let storedDraft = null;
      let resumeScreen = '';
      try {
        resumeScreen = readDraftScreen();
        if (resumeScreen) {
          storedDraft = await loadPendingDraft();
          if (!storedDraft) resumeScreen = '';
        }
      } catch {
        storedDraft = null;
        resumeScreen = '';
      }
      // A persisted one-shot destination ({screen, category} only) survives a
      // refresh or a full-page verify/reset link; it is consumed at sign-in
      // and never holds passwords, tokens, or drafts.
      const storedPostAuth = readPostAuth();
      if (verify) {
        // Single-consume verification: the attempt is recorded synchronously
        // before the async request, so React StrictMode's effect replay (and
        // any remount) cannot submit the same token twice. The raw token
        // lives in memory only and is cleared after one attempt; only the
        // outcome persists, so returning to this screen never resubmits it.
        // The pending report-creation destination and category survive.
        if (storedDraft) setPendingDraft(storedDraft);
        if (storedPostAuth) setPostAuth(storedPostAuth);
        setScreen('verify');
        setSessionUser(null);
        if (shouldAttemptVerify(verify, verifyAttemptRef.current)) {
          verifyAttemptRef.current = verify;
          setVerifyToken('');
          setVerifyStatus('verifying');
          setVerifyError('');
          try {
            await api.verifyResident(verify);
            setVerifyStatus('verified');
            setVerifyError('');
            saveVerifyResult({ status: 'verified' });
          } catch (err) {
            const message = err?.message || 'That confirmation link is not valid. Request a new one.';
            setVerifyStatus('invalid');
            setVerifyError(message);
            saveVerifyResult({ status: 'invalid', error: message });
          }
        } else if (verifyAttemptRef.current !== verify) {
          setVerifyStatus('pending');
          setVerifyError('');
        }
        try {
          window.history.replaceState(sanitizeHistoryState({ screen: 'verify' }) || { screen: 'verify' }, '', window.location.pathname);
        } catch {
          // History failure must never break verification.
        }
        navSyncRef.current.lastPushed = JSON.stringify({ screen: 'verify' });
        saveNavRestore({ screen: 'verify' });
        setReady(true);
        return;
      }
      if (reset) {
        setResetToken(reset);
        if (storedDraft) setPendingDraft(storedDraft);
        if (storedPostAuth) setPostAuth(storedPostAuth);
        setScreen('reset');
        setSessionUser(null);
        setReady(true);
        return;
      }
      if (storedDraft && resumeScreen) {
        setPendingDraft(storedDraft);
      }
      let session;
      try {
        session = await api.trySession();
      } catch {
        // No signed-in session: report creation (buttons, direct URLs,
        // refresh-resumed drafts) goes to resident signup with a notice.
        // The post-auth destination is preserved so sign-in resumes it.
        setSessionUser(null);
        if (storedDraft && resumeScreen) {
          const destination = { screen: resumeScreen };
          setPostAuth(destination);
          savePostAuth(destination);
          setAuthNotice(sessionStorage.getItem('proofpath.sessionExpired') ? SESSION_EXPIRED_NOTICE : CREATE_GATE_NOTICE);
          sessionStorage.removeItem('proofpath.sessionExpired');
          setScreen('signup');
        } else if (storedPostAuth) {
          // Signed-out "Create a report" entry survived a refresh with no
          // draft yet (empty wizard saves nothing): resume the signup gate.
          setPostAuth(storedPostAuth);
          setAuthNotice(CREATE_GATE_NOTICE);
          setScreen('signup');
        } else {
          // A refresh on a public screen (signin, signup, verify, privacy,
          // recovery) restores that screen so typed context survives; the
          // verification outcome (never the token) is restored with it.
          // Protected history entries stay behind the signup gate.
          const restoredPublic = readHistoryNav() || readNavRestore();
          if (restoredPublic && !isProtectedScreen(restoredPublic.screen)) {
            if (restoredPublic.screen === 'verify') {
              const stored = readVerifyResult();
              if (stored) {
                setVerifyStatus(stored.status);
                setVerifyError(stored.error || '');
              } else {
                setVerifyStatus('pending');
                setVerifyError('');
              }
            }
            if (restoredPublic.privacyReturn) setPrivacyReturn(restoredPublic.privacyReturn);
            setScreen(restoredPublic.screen);
          } else {
            setScreen('homepage');
            try {
              if (!readDraftScreen()) await clearPendingDraft();
            } catch {
              // Ignore storage failures.
            }
          }
        }
        setReady(true);
        return;
      }
      setSessionUser(session);
      // A signed-in refresh consumes no gate: drop any stale one-shot
      // destination left behind by an abandoned signed-out entry.
      clearPostAuth();
      if (storedDraft && resumeScreen) {
        // Never restore one account's draft into another: only the owner
        // (or an unowned guest draft) resumes; otherwise discard it.
        const ownerId = readDraftOwner();
        if (ownerId == null || ownerId === session.id) {
          setPendingDraft(storedDraft);
          setScreen(resumeScreen);
        } else {
          setPendingDraft(null);
          try {
            await clearPendingDraft();
          } catch {
            // Ignore storage failures.
          }
          setScreen(session.role === 'resident' ? 'myreports' : 'dashboard');
        }
      } else {
        // A refresh restores the selected report (details, delivery,
        // preview, edit) or account screen from the allowlisted history
        // entry; anything unrestorable falls back to the role landing page.
        const restored = readHistoryNav() || readNavRestore();
        if (restored && (restored.screen === 'detail' || restored.screen === 'delivery' || restored.screen === 'preview' || restored.screen === 'edit') && restored.detailId) {
          setDetailId(restored.detailId);
          if (restored.deliveryOrigin) setDeliveryOrigin(restored.deliveryOrigin);
          setScreen(restored.screen);
          loadDetail(restored.detailId);
        } else if (restored && (restored.screen === 'settings' || restored.screen === 'password')) {
          if (restored.screen === 'password') {
            setPwdReturn(session.role === 'resident' ? 'settings' : 'dashboard');
          }
          setScreen(restored.screen);
        } else {
          // A refreshed resident lands on Your reports, not the staff journal.
          setScreen(session.role === 'resident' ? 'myreports' : 'dashboard');
        }
      }
      setReady(true);
      const viewer = session.role === 'super_admin' || session.role === 'resident' || session.privileges.includes('reports_view');
      try {
        setAiStatus(await api.aiStatus());
      } catch {
        setAiStatus(null);
      }
      if (viewer) {
        try {
          setReports(await api.reports());
          setReportsError(false);
        } catch {
          setReports([]);
          setReportsError(true);
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
      setReportsError(false);
    } catch {
      // api() already redirects on 401; other errors keep the current list
      // but are surfaced distinctly from an empty list.
      setReportsError(true);
    }
  }

  function showDashboard() {
    // Residents and signed-out visitors use the handoff "Your reports"
    // screen; staff keep the shared journal dashboard.
    if (!sessionUser || sessionUser.role === 'resident') {
      showMyReports();
      return;
    }
    setScreen('dashboard');
    setAdminsOpen(false);
    setDetail(null);
    setDetailId(null);
    refreshReports();
    scrollShellTop();
  }

  function showMyReports() {
    setSettingsSaved(false);
    setAdminsOpen(false);
    setDetail(null);
    setDetailId(null);
    setScreen('myreports');
    refreshReports();
    scrollShellTop();
  }

  function openWizard(category = '') {
    // Auth gate: every signed-out 'Create a report' entry redirects to
    // resident signup with a notice; the destination is preserved so the
    // new session goes straight to upload. Signed-in users skip the gate.
    // Signed-in users without report-creation permission never reach the
    // upload screen; the backend enforces the same rule on every endpoint.
    if (sessionUser && !canCreate) {
      showDashboard();
      return;
    }
    if (!sessionUser) {
      setAdminsOpen(false);
      setPendingDraft(null);
      setWizardCategory(category);
      const destination = { screen: 'wizard', category };
      setPostAuth(destination);
      savePostAuth(destination);
      setAuthNotice(CREATE_GATE_NOTICE);
      setScreen('signup');
      scrollShellTop();
      return;
    }
    setAdminsOpen(false);
    setWizardCategory(category);
    setPendingDraft(null);
    setPostAuth(null);
    clearPostAuth();
    setAuthNotice('');
    // A fresh report replaces any abandoned draft.
    clearPendingDraft();
    markDraftScreen('');
    setScreen('wizard');
    scrollShellTop();
  }

  // Guest save handoff (screen 10): keep the in-progress draft in memory and
  // in persistent storage while the visitor signs in or registers (including
  // across the full-page verify link); nothing uploads yet.
  function openSaveGate(snapshot) {
    setAdminsOpen(false);
    setPendingDraft(snapshot);
    savePendingDraft(snapshot);
    markDraftScreen('savegate');
    setScreen('savegate');
    scrollShellTop();
  }

  function backToDraft() {
    markDraftScreen('wizard');
    setScreen('wizard');
    scrollShellTop();
  }

  function openPrivacy() {
    // Remember the exact screen so Privacy & help returns to it; typed
    // non-sensitive values survive because the auth forms keep them in
    // session storage (passwords are never stored).
    setPrivacyReturn(screen);
    setAdminsOpen(false);
    setScreen('privacy');
    scrollShellTop();
  }

  // Explicit cancel of a gate flow (signup/signin/savegate "Back to home"):
  // drop the one-shot destination so a later visit starts clean.
  function cancelAuthGate() {
    setPostAuth(null);
    clearPostAuth();
    setAuthNotice('');
    setScreen('homepage');
    scrollShellTop();
  }

  function backFromPrivacy() {
    if (privacyReturn && privacyReturn !== 'privacy') {
      // Re-entering the exact screen remounts its form, which rehydrates
      // typed non-sensitive values from session storage (passwords are
      // never stored, so they are intentionally not restored).
      setScreen(privacyReturn);
      scrollShellTop();
      return;
    }
    if (pendingDraft) {
      setScreen('savegate');
    } else {
      setScreen('homepage');
    }
    scrollShellTop();
  }

  function openSettings() {
    setSettingsSaved(false);
    setAdminsOpen(false);
    setScreen('settings');
    scrollShellTop();
  }

  // Scroll the content lane (the header stays fixed, so the window
  // itself no longer scrolls on shell screens).
  function scrollShellTop() {
    const lane = document.querySelector('.app-scroll');
    if (lane) lane.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Browser-history sync: every in-app screen change pushes one allowlisted
  // entry (screen + selected report + return markers only — never passwords,
  // files, or tokens), so browser Back/Forward walks report lists, details,
  // delivery, preview, auth, and Privacy & help in order. Identical states
  // are never pushed twice, same-screen updates replace instead of pushing,
  // and pop-driven updates never push again.
  const refreshRef = useRef(null);
  refreshRef.current = refreshReports;

  function currentNavSnapshot() {
    return sanitizeHistoryState({ screen, detailId, privacyReturn, deliveryOrigin });
  }

  function pushNavSnapshot(snapshot, replace) {
    const clean = sanitizeHistoryState(snapshot);
    if (!clean) return;
    const key = JSON.stringify(clean);
    if (key === navSyncRef.current.lastPushed) return;
    try {
      if (replace) window.history.replaceState(clean, '', window.location.pathname);
      else window.history.pushState(clean, '', window.location.pathname);
    } catch {
      return;
    }
    navSyncRef.current.lastPushed = key;
    if (!replace) navSyncRef.current.depth += 1;
    saveNavRestore(clean);
  }

  useEffect(() => {
    if (!ready) return;
    const snapshot = currentNavSnapshot();
    if (!snapshot) return;
    if (navSyncRef.current.applyingPop) {
      navSyncRef.current.applyingPop = false;
      navSyncRef.current.lastPushed = JSON.stringify(snapshot);
      saveNavRestore(snapshot);
      return;
    }
    let replace = false;
    try {
      // The first sync after load adopts the current entry (covers reloads
      // with or without a prior state); later same-screen updates replace
      // while screen changes push, so no duplicate entries accumulate.
      if (!navSyncRef.current.lastPushed) {
        replace = true;
      } else {
        const parsed = JSON.parse(navSyncRef.current.lastPushed);
        replace = Boolean(parsed && parsed.screen === snapshot.screen);
      }
    } catch {
      replace = false;
    }
    pushNavSnapshot(snapshot, replace);
  });

  useEffect(() => {
    async function ensureSession() {
      if (sessionUserRef.current) {
        try {
          const fresh = await api.trySession();
          setSessionUser(fresh);
          return fresh;
        } catch (err) {
          if (err && err.status === 401) {
            setSessionUser(null);
            return null;
          }
          return sessionUserRef.current;
        }
      }
      try {
        const fresh = await api.trySession();
        setSessionUser(fresh);
        return fresh;
      } catch {
        return null;
      }
    }

    async function onPop(event) {
      const next = sanitizeHistoryState(event.state) || readNavRestore();
      navSyncRef.current.applyingPop = true;
      navSyncRef.current.depth = Math.max(0, navSyncRef.current.depth - 1);
      if (!next) {
        if (sessionUserRef.current) {
          const user = sessionUserRef.current;
          setAdminsOpen(false);
          setDetail(null);
          setDetailId(null);
          setScreen(!user || user.role === 'resident' ? 'myreports' : 'dashboard');
          try { await refreshRef.current(); } catch { /* refresh keeps its own error state */ }
        } else {
          setScreen('homepage');
        }
        scrollShellTop();
        return;
      }
      if (isProtectedScreen(next.screen)) {
        // Signed-out history walks must never reveal protected content:
        // recheck the session first and gate when it is gone.
        const session = await ensureSession();
        if (!session) {
          setReports([]);
          setDetail(null);
          setDetailId(null);
          setPendingDraft(null);
          setPostAuth(null);
          clearPostAuth();
          setAuthNotice(CREATE_GATE_NOTICE);
          setScreen('signup');
          scrollShellTop();
          return;
        }
        if (next.detailId && (next.screen === 'detail' || next.screen === 'delivery' || next.screen === 'preview' || next.screen === 'edit')) {
          if (next.deliveryOrigin) setDeliveryOrigin(next.deliveryOrigin);
          // loadDetail sets the id, loading state, and screen-adjacent data;
          // unavailable reports land on the existing recovery UI.
          setScreen(next.screen);
          loadDetail(next.detailId);
        } else if (next.screen === 'settings' || next.screen === 'password') {
          setScreen(next.screen);
        } else {
          const user = session;
          setAdminsOpen(false);
          setDetail(null);
          setDetailId(null);
          setScreen(!user || user.role === 'resident' ? 'myreports' : 'dashboard');
          try { await refreshRef.current(); } catch { /* refresh keeps its own error state */ }
        }
        scrollShellTop();
        return;
      }
      if (next.screen === 'verify') {
        const stored = readVerifyResult();
        if (stored) {
          setVerifyStatus(stored.status);
          setVerifyError(stored.error || '');
        }
        setScreen('verify');
      } else {
        if (next.privacyReturn) setPrivacyReturn(next.privacyReturn);
        setScreen(next.screen);
      }
      scrollShellTop();
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // Mount-only: live state flows through refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Belt-and-braces: a protected screen with no session always resolves to
  // the signup gate instead of flashing stale content.
  useEffect(() => {
    if (!ready || sessionUser) return;
    if (isProtectedScreen(screen)) {
      setAuthNotice(CREATE_GATE_NOTICE);
      setScreen('signup');
    }
  }, [screen, sessionUser, ready]);

  // In-app Back for the report flow follows the browser stack when this
  // session created it, so in-app and browser Back always agree; a direct
  // entry (refresh or deep link) falls back to the logical parent instead.
  function backOrNavigate(fallback) {
    if (navSyncRef.current.depth > 0) {
      try {
        window.history.back();
        return;
      } catch {
        // Fall through to the logical parent.
      }
    }
    fallback();
  }



  async function handleSignOut() {
    try {
      await api.signOut();
    } catch {
      // Cookie clearing already attempted; drop local state regardless.
    }
    // Sign-out never hands this account's in-memory or stored draft to the
    // next visitor: drop both so the next sign-in starts clean.
    setSessionUser(null);
    setReports([]);
    setAdminsOpen(false);
    setDetail(null);
    setDetailId(null);
    setSettingsSaved(false);
    setPendingDraft(null);
    setPostAuth(null);
    clearPostAuth();
    // Drop any stored navigation snapshot so a refresh after sign-out
    // cannot restore protected context; the sync effect records homepage.
    clearNavRestore();
    setAuthNotice('');
    try {
      await clearPendingDraft();
    } catch {
      // Ignore storage failures.
    }
    markDraftScreen('');
    setScreen('homepage');
    scrollShellTop();
  }

  async function loadDetail(id) {
    setDetailId(id);
    setDetail(null);
    setDetailState('loading');
    try {
      const full = await api.getReport(id);
      setDetail(full);
      setDetailState('ready');
    } catch {
      setDetailState('error');
    }
  }

  function openReport(summary) {
    const id = typeof summary === 'string' ? summary : summary.id;
    setAdminsOpen(false);
    setScreen('detail');
    scrollShellTop();
    loadDetail(id);
  }

  function applyUpdated(updated) {
    setDetail(updated);
    setLastSaved((current) => (current?.id === updated.id ? { ...current, ...updated } : current));
    setReports((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
  }

  async function saveEdit(payload) {
    const updated = await api.editReport(detailId, payload);
    applyUpdated(updated);
    setScreen('detail');
    scrollShellTop();
  }

  function removeDeleted(id) {
    setReports((current) => current.filter((item) => item.id !== id));
    if (lastSaved?.id === id) setLastSaved(null);
  }

  function openPassword() {
    setAdminsOpen(false);
    setPwdReturn(sessionUser?.role === 'resident' ? 'settings' : 'dashboard');
    setScreen('password');
    scrollShellTop();
  }

  function openSignIn(notice = '') {
    setAdminsOpen(false);
    // A notice explains *why* sign-in is needed (expired session, signup
    // gate); a fresh visit shows the plain sign-in card. Never let a click
    // event passed as a bare onClick handler become the notice text, and
    // never clear the one-shot post-auth destination when switching between
    // sign-in and signup.
    setAuthNotice(typeof notice === 'string' ? notice : '');
    setScreen('signin');
    scrollShellTop();
  }

  function openSignUp() {
    setAdminsOpen(false);
    if (!authNotice) setAuthNotice('');
    setScreen('signup');
    scrollShellTop();
  }

  function handleAccountCreated(created) {
    setPendingEmail(created?.email || '');
    setDevPreviewUrl(created?.dev_preview_url || '');
    setVerifyToken('');
    // A fresh signup starts from the pending notice: drop any previous
    // verification outcome so it cannot leak into this account's flow.
    verifyAttemptRef.current = '';
    setVerifyStatus('pending');
    setVerifyError('');
    clearVerifyResult();
    setScreen('verify');
    scrollShellTop();
  }

  async function handleSignedIn(session) {
    setSessionUser(session);
    // Narrow save race first: if a report was created just before the
    // previous session expired, open that existing report instead of
    // resuming the wizard and saving a duplicate.
    let resumedId = null;
    try {
      resumedId = sessionStorage.getItem('proofpath.pendingCreated');
      sessionStorage.removeItem('proofpath.pendingCreated');
    } catch {
      resumedId = null;
    }
    if (resumedId) {
      setPendingDraft(null);
      try {
        await clearPendingDraft();
      } catch {
        // Ignore storage failures.
      }
      markDraftScreen('');
      setPostAuth(null);
      clearPostAuth();
      setAuthNotice('');
      openReport(resumedId);
      const viewer = session.role === 'super_admin' || session.role === 'resident' || session.privileges.includes('reports_view');
      try {
        setAiStatus(await api.aiStatus());
      } catch {
        setAiStatus(null);
      }
      if (viewer) {
        try {
          setReports(await api.reports());
          setReportsError(false);
        } catch {
          setReports([]);
          setReportsError(true);
        }
      }
      return;
    }
    // A preserved pre-auth draft claims the new session only when it is
    // unowned or owned by this account; another account's draft is never
    // restored here. The post-auth destination (straight to upload) wins
    // over the default landing screen.
    let draft = pendingDraft;
    if (!draft) {
      try {
        // Only claim a draft that an in-flow screen left behind; a cleared
        // marker means the visitor already moved on.
        draft = readDraftScreen() ? await loadPendingDraft() : null;
      } catch {
        draft = null;
      }
    }
    if (draft) {
      const ownerId = draft.ownerId ?? readDraftOwner();
      if (ownerId != null && ownerId !== session.id) {
        draft = null;
        setPendingDraft(null);
        try {
          await clearPendingDraft();
        } catch {
          // Ignore storage failures.
        }
      } else if (draft !== pendingDraft) {
        setPendingDraft(draft);
      }
    }
    // The in-memory destination wins; the persisted copy covers a refresh or
    // full-page verify link that wiped React state. Either way it is
    // one-shot: cleared here so it cannot leak into a later sign-in.
    const destination = postAuth || readPostAuth();
    setPostAuth(null);
    clearPostAuth();
    setAuthNotice('');
    if (draft) {
      markDraftScreen('wizard');
      setScreen('wizard');
      scrollShellTop();
    } else if (destination?.screen === 'wizard') {
      setWizardCategory(destination.category || '');
      markDraftScreen('');
      setScreen('wizard');
      scrollShellTop();
    } else if (destination?.screen === 'savegate') {
      markDraftScreen('savegate');
      setScreen('savegate');
      scrollShellTop();
    } else if (session.role === 'resident') {
      setScreen('myreports');
      scrollShellTop();
    } else {
      setScreen('dashboard');
      scrollShellTop();
    }
    const viewer = session.role === 'super_admin' || session.role === 'resident' || session.privileges.includes('reports_view');
    try {
      setAiStatus(await api.aiStatus());
    } catch {
      setAiStatus(null);
    }
    if (viewer) {
      try {
        setReports(await api.reports());
        setReportsError(false);
      } catch {
        setReports([]);
        setReportsError(true);
      }
    }
  }

  const [deliveryOrigin, setDeliveryOrigin] = useState('detail');

  function openDelivery(id) {
    setAdminsOpen(false);
    const target = id || lastSaved?.id;
    if (!target) return;
    setDeliveryOrigin(screen === 'saved' ? 'saved' : 'detail');
    setScreen('delivery');
    if (detail?.id !== target) loadDetail(target);
    scrollShellTop();
  }

  function onSaved(report, file) {
    if (savedPreviewUrl) URL.revokeObjectURL(savedPreviewUrl);
    // The preserved guest draft is now claimed by this resident account.
    setPendingDraft(null);
    clearPendingDraft();
    clearPostAuth();
    markDraftScreen('');
    setLastSaved(report);
    setSavedIsVideo(file.type.startsWith('video/'));
    setSavedPreviewUrl(URL.createObjectURL(file));
    setScreen('saved');
    refreshReports();
    scrollShellTop();
  }

  function onReviewSaved() {
    const id = lastSaved?.id;
    if (id) {
      openReport(id);
      setHighlightId(id);
      window.setTimeout(() => setHighlightId(null), 1600);
    } else {
      showDashboard();
    }
  }

  function toggleAdmins() {
    setScreen('dashboard');
    setAdminsOpen((value) => !value);
  }

  if (!ready) return null;

  if (screen === 'homepage') {
    return <Homepage sessionUser={sessionUser} onStartReport={openWizard} onShowReports={showDashboard} onSignIn={openSignIn} onPrivacyHelp={openPrivacy} />;
  }

  if (screen === 'signin') {
    return (
      <SignIn
        notice={authNotice}
        onSuccess={handleSignedIn}
        onBackHome={cancelAuthGate}
        onCreateAccount={openSignUp}
        onForgotPassword={() => setScreen('recover')}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'signup') {
    return (
      <CreateAccount
        initialEmail={pendingEmail}
        notice={authNotice}
        onCreated={handleAccountCreated}
        onSignIn={openSignIn}
        onBackHome={cancelAuthGate}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'verify') {
    return (
      <VerifyEmail
        email={pendingEmail}
        status={verifyStatus}
        errorMessage={verifyError}
        devPreviewUrl={devPreviewUrl}
        onContinueSignIn={openSignIn}
        onUseDifferentEmail={() => setScreen('signup')}
        onBackHome={() => setScreen('homepage')}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'recover') {
    return (
      <RecoverPassword
        initialEmail={resetEmail || pendingEmail}
        onSent={(address) => { setResetEmail(address); setScreen('resent'); scrollShellTop(); }}
        onBackSignIn={openSignIn}
        onBackHome={() => setScreen('homepage')}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'resent') {
    return (
      <ResetLinkSent
        onBackSignIn={openSignIn}
        onUseDifferentEmail={() => setScreen('recover')}
        onBackHome={() => setScreen('homepage')}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'reset') {
    return (
      <ResetPassword
        token={resetToken}
        onReset={() => { setResetToken(''); setScreen('resetdone'); scrollShellTop(); }}
        onBackHome={() => setScreen('homepage')}
        onPrivacyHelp={openPrivacy}
        onRequestNewLink={() => setScreen('recover')}
      />
    );
  }

  if (screen === 'resetdone') {
    return (
      <PasswordUpdated
        onSignIn={openSignIn}
        onBackHome={() => setScreen('homepage')}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'savegate') {
    return (
      <SaveReportGate
        draft={pendingDraft}
        onCreateAccount={openSignUp}
        onSignIn={openSignIn}
        onBackToReport={backToDraft}
        onBackHome={cancelAuthGate}
        onPrivacyHelp={openPrivacy}
      />
    );
  }

  if (screen === 'privacy') {
    return (
      <PrivacyHelp
        // Signed-out visitors go through the signup gate; signed-in users
        // with a preserved draft resume it instead of starting fresh.
        onCreateReport={() => (sessionUser && pendingDraft ? backToDraft() : openWizard(''))}
        onBackHome={backFromPrivacy}
        backLabel={privacyBackLabel(privacyReturn)}
      />
    );
  }

  if (screen === 'settings') {
    return (
      <div className="app-shell">
        <Topbar
          sessionUser={sessionUser}
          isSuperAdmin={false}
          adminActive={false}
          activeNav="settings"
          onShowReports={showMyReports}
          onToggleAdmins={() => {}}
          onOpenSettings={openSettings}
          onSignOut={handleSignOut}
        />
        <div className="app-scroll">
          <main>
            <AccountSettings
              sessionUser={sessionUser}
              savedFlash={settingsSaved}
              onSaved={() => { setSettingsSaved(true); refreshReports(); }}
              onChangePassword={openPassword}
            />
          </main>
          <footer className="page-footer">
            <span>
              ProofPath AI <span className="footer-separator">/</span> Community reporting assistant
            </span>
            <span>AI suggestions are not official inspections.</span>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {screen !== 'preview' && (
        <Topbar
          sessionUser={sessionUser}
          isSuperAdmin={isSuperAdmin && screen === 'dashboard'}
          adminActive={adminsOpen}
          activeNav={adminsOpen ? 'admins' : screen === 'dashboard' || screen === 'myreports' ? 'reports' : null}
          onShowReports={showDashboard}
          onToggleAdmins={toggleAdmins}
          onOpenSettings={openSettings}
          onSignOut={handleSignOut}
        />
      )}
      <div className="app-scroll">
      <main>
        {screen === 'myreports' && (
          <YourReports
            sessionUser={sessionUser}
            reports={reports}
            canEdit={canEdit}
            canStatus={canStatus}
            canDelete={canDelete}
            highlightId={highlightId}
            reportsError={reportsError}
            onSignIn={openSignIn}
            onNewReport={() => openWizard('')}
            onOpenReport={openReport}
            onRetry={refreshReports}
          />
        )}
        {screen === 'dashboard' && (
          <>
            {isSuperAdmin && adminsOpen ? (
              <AdminPanel />
            ) : (
              <Dashboard
                sessionUser={sessionUser}
                reports={reports}
                canView={canView}
                canCreate={canCreate}
                canEdit={canEdit}
                canStatus={canStatus}
                canDelete={canDelete}
                highlightId={highlightId}
                reportsError={reportsError}
                onOpenWizard={openWizard}
                onOpenReport={openReport}
                onOpenPassword={openPassword}
                onRetry={refreshReports}
              />
            )}
          </>
        )}
        {screen === 'password' && (
          <PasswordForm
            sessionUser={sessionUser}
            onBack={() => (pwdReturn === 'settings' ? openSettings() : showDashboard())}
          />
        )}
        {screen === 'detail' && (
          <>
            {detailState === 'loading' && (
              <section className="w-flow" aria-live="polite">
                <p className="w-sub">Loading report…</p>
              </section>
            )}
            {detailState === 'error' && (
              <section className="w-flow" aria-labelledby="detail-error-heading">
                <h1 id="detail-error-heading">Report unavailable</h1>
                <p className="w-sub">This report could not be loaded. It may have been removed or shared outside your workspace.</p>
                <div className="w-foot">
                  <button type="button" className="w-link" onClick={() => backOrNavigate(showDashboard)}>
                    Back to reports
                  </button>
                  <button type="button" className="w-outline" onClick={() => loadDetail(detailId)}>
                    Try again
                  </button>
                </div>
              </section>
            )}
            {detailState === 'ready' && detail && (
              <ReportDetails
                report={detail}
                canEdit={canEdit}
                canStatus={canStatus}
                canDelete={canDelete}
                canDownload={canView}
                onBack={() => backOrNavigate(showDashboard)}
                onEdit={() => setScreen('edit')}
                onChangeStatus={() => setStatusOpen(true)}
                onAskDelete={() => setDeleteOpen(true)}
                onDownload={() => openDelivery(detail.id)}
              />
            )}
            {statusOpen && detail && (
              <StatusDialog report={detail} onClose={() => setStatusOpen(false)} onUpdated={applyUpdated} />
            )}
            {deleteOpen && detail && (
              <DeleteDialog
                report={detail}
                onClose={() => setDeleteOpen(false)}
                onDeleted={(id) => {
                  removeDeleted(id);
                  showDashboard();
                }}
              />
            )}
          </>
        )}
        {screen === 'edit' && detail && (
          <ReportEdit report={detail} onCancel={() => setScreen('detail')} onSave={saveEdit} />
        )}
        {screen === 'delivery' && (
          <>
            {detail ? (
              <ReportDelivery
                report={detail}
                backLabel={deliveryOrigin === 'saved' && lastSaved ? 'Back to saved report' : 'Back to report details'}
                onBack={() => backOrNavigate(() => setScreen(deliveryOrigin === 'saved' && lastSaved ? 'saved' : 'detail'))}
                onViewPreview={() => setScreen('preview')}
              />
            ) : detailState === 'error' ? (
              <section className="w-flow" aria-labelledby="delivery-error-heading">
                <h1 id="delivery-error-heading">Report unavailable</h1>
                <p className="w-sub">This report could not be loaded, so there is nothing to download yet.</p>
                <div className="w-foot">
                  <button type="button" className="w-link" onClick={() => backOrNavigate(showDashboard)}>
                    Back to reports
                  </button>
                  <button type="button" className="w-outline" onClick={() => loadDetail(detailId || lastSaved?.id)}>
                    Try again
                  </button>
                </div>
              </section>
            ) : (
              <section className="w-flow" aria-live="polite">
                <p className="w-sub">Loading report…</p>
              </section>
            )}
          </>
        )}
        {screen === 'preview' && (
          detail ? (
            <PdfPreview report={detail} onBack={() => backOrNavigate(() => setScreen('delivery'))} />
          ) : detailState === 'error' ? (
            <section className="w-flow" aria-labelledby="preview-error-heading">
              <h1 id="preview-error-heading">Report unavailable</h1>
              <p className="w-sub">The preview could not be loaded because the report itself failed to load.</p>
              <div className="w-foot">
                <button type="button" className="w-link" onClick={() => backOrNavigate(showDashboard)}>
                  Back to reports
                </button>
                <button type="button" className="w-outline" onClick={() => loadDetail(detailId || lastSaved?.id)}>
                  Try again
                </button>
              </div>
            </section>
          ) : (
            <section className="w-flow" aria-live="polite">
              <p className="w-sub">Loading report…</p>
            </section>
          )
        )}
        {screen === 'wizard' && (
          <Wizard
            aiStatus={aiStatus}
            signedIn={Boolean(sessionUser)}
            ownerId={sessionUser?.id ?? null}
            initialCategory={wizardCategory}
            initialDraft={pendingDraft}
            onSaved={onSaved}
            onCancel={showDashboard}
            onRequireAccount={openSaveGate}
            onSignIn={() => {
              // Mid-workflow expiry: the autosaved draft stays in storage,
              // so signing in resumes the wizard without duplicates.
              const destination = { screen: 'wizard' };
              setPostAuth(destination);
              savePostAuth(destination);
              openSignIn('Your session expired. Sign in to continue — your draft is preserved.');
            }}
          />
        )}
        {screen === 'saved' && lastSaved && (
          <SavedScreen
            report={lastSaved}
            previewUrl={savedPreviewUrl}
            isVideo={savedIsVideo}
            canStatus={canStatus}
            onBack={showDashboard}
            onReview={onReviewSaved}
            onDownload={() => openDelivery(lastSaved.id)}
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
      </div>
    </div>
  );
}
