function redirectToLogin() {
  window.location.assign('/login');
  throw new Error('Please sign in.');
}

export async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 401) redirectToLogin();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Request failed.');
  return data;
}

export const api = {
  session: () => apiJson('/api/session'),
  aiStatus: () => apiJson('/api/ai/status'),
  reports: () => apiJson('/api/reports'),
  admins: () => apiJson('/api/admins'),
  createReport: (formData) => apiJson('/api/reports', { method: 'POST', body: formData }),
  updateStatus: (id, status) =>
    apiJson(`/api/reports/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
  editReport: (id, payload) =>
    apiJson(`/api/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteReport: async (id) => {
    const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.status === 401) redirectToLogin();
    if (!response.ok) throw new Error('Report could not be deleted.');
  },
  segment: (file) => {
    const data = new FormData();
    data.append('evidence', file);
    return apiJson('/api/ai/segment', { method: 'POST', body: data });
  },
  assist: (payload) =>
    apiJson('/api/ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
};

export const PRIVILEGE_CHOICES = [
  ['reports_view', 'View reports and evidence'],
  ['reports_create', 'Create reports'],
  ['reports_edit', 'Edit report details'],
  ['reports_status', 'Change report status'],
  ['reports_delete', 'Delete reports and evidence'],
];

export const CATEGORIES = [
  'Road damage',
  'Waste and litter',
  'Street lighting',
  'Sidewalk and access',
  'Drainage and flooding',
  'Public facility',
  'Other',
];

export const STATUSES = ['Draft', 'Submitted', 'Resolved'];

export const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
