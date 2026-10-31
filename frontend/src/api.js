function redirectToLogin() {
  window.location.assign('/login');
  throw new Error('Please sign in.');
}

export async function apiJson(path, options = {}) {
  const { loginRedirect = true, ...fetchOptions } = options;
  let response;
  try {
    response = await fetch(path, fetchOptions);
  } catch {
    // Never surface raw browser network errors to the UI.
    throw new Error('Network error. Check your connection and try again.');
  }
  if (response.status === 401 && loginRedirect) redirectToLogin();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Carry the HTTP status so in-flow screens (wizard) can tell an
    // expired session apart from other failures without redirecting.
    const error = new Error(data.detail || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function apiBlob(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Network error. Check your connection and try again.');
  }
  if (response.status === 401) redirectToLogin();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Request failed.');
  }
  return response.blob();
}

export function formatLongDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return value;
  }
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

export const api = {
  session: () => apiJson('/api/session'),
  // Guest-safe session check for the public landing page: throws instead of redirecting.
  trySession: () => apiJson('/api/session', { loginRedirect: false }),
  // Resident sign-in without leaving the app; throws the server's generic message on failure.
  login: (payload) =>
    apiJson('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      loginRedirect: false,
    }),
  aiStatus: () => apiJson('/api/ai/status'),
  reports: () => apiJson('/api/reports'),
  admins: () => apiJson('/api/admins'),
  createReport: (formData, opts = {}) => apiJson('/api/reports', { method: 'POST', body: formData, loginRedirect: opts.loginRedirect ?? true }),
  getReport: (id) => apiJson(`/api/reports/${encodeURIComponent(id)}`),
  updateStatus: (id, status, opts = {}) =>
    apiJson(`/api/reports/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, confirm_downgrade: Boolean(opts.confirmDowngrade) }),
    }),
  reportPdfUrl: (id) => `/api/reports/${encodeURIComponent(id)}/pdf`,
  downloadReportPdf: (id) => apiBlob(`/api/reports/${encodeURIComponent(id)}/pdf`),
  editReport: (id, payload, opts = {}) =>
    apiJson(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      loginRedirect: opts.loginRedirect ?? true,
    }),
  deleteReport: async (id) => {
    let response;
    try {
      response = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      throw new Error('Network error. Check your connection and try again.');
    }
    if (response.status === 401) redirectToLogin();
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) throw new Error(data.detail || 'You do not have permission to delete this report.');
      throw new Error('Report could not be deleted.');
    }
  },
  // Wizard-only AI calls: never hard-redirect on 401. The wizard keeps the
  // draft, explains the expired session inline, and offers in-app sign-in.
  segment: (file, signal) => {
    const data = new FormData();
    data.append('evidence', file);
    return apiJson('/api/ai/segment', { method: 'POST', body: data, signal, loginRedirect: false });
  },
  assist: (payload, signal) =>
    apiJson('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
      loginRedirect: false,
    }),
  createAdmin: (payload) =>
    apiJson('/api/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateAdmin: (id, payload) =>
    apiJson(`/api/admins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  changePassword: (payload) =>
    apiJson('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  signup: (payload) =>
    apiJson('/api/residents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      loginRedirect: false,
    }),
  verifyResident: (token) =>
    apiJson('/api/residents/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      loginRedirect: false,
    }),
  resendVerification: (email) =>
    apiJson('/api/residents/verify/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      loginRedirect: false,
    }),
  requestPasswordReset: (email) =>
    apiJson('/api/residents/password/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      loginRedirect: false,
    }),
  resetPassword: (token, password) =>
    apiJson('/api/residents/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
      loginRedirect: false,
    }),
  getAccount: () => apiJson('/api/account', { loginRedirect: false }),
  updateAccount: (payload) =>
    apiJson('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  signOut: () => fetch('/logout', { method: 'POST' }),
};

export const PRIVILEGE_CHOICES = [
  ['reports_view', 'View reports and evidence'],
  ['reports_create', 'Create reports'],
  ['reports_edit', 'Edit report details'],
  ['reports_status', 'Change report status'],
  ['reports_delete', 'Delete reports and evidence'],
];

export const CATEGORIES = [
  'Roads and pathways',
  'Road damage',
  'Waste and litter',
  'Street lighting',
  'Sidewalk and access',
  'Drainage and flooding',
  'Public facility',
  'Other',
];

export const STATUSES = ['Draft', 'Submitted', 'Resolved'];

export function evidenceUrlFor(report) {
  if (!report?.evidence_name) return '';
  return `/api/evidence/${encodeURIComponent(report.evidence_name)}`;
}

export function isVideoReport(report) {
  return String(report?.evidence_type || '').startsWith('video/');
}

export const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
