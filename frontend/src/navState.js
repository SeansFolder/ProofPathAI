// Allowlisted navigation state shared by the App history sync and tests.
//
// Everything here is pure and DOM-optional so it can be unit-tested with
// node:test. History entries, restore markers, and verification results
// carry only {screen, detailId, privacyReturn, deliveryOrigin, status} —
// never passwords, evidence files, raw tokens, or auth payloads.
export const PUBLIC_SCREENS = new Set([
  'homepage',
  'signin',
  'signup',
  'verify',
  'recover',
  'resent',
  'reset',
  'resetdone',
  'privacy',
  'savegate',
]);

export const PROTECTED_SCREENS = new Set([
  'dashboard',
  'myreports',
  'detail',
  'edit',
  'delivery',
  'preview',
  'wizard',
  'saved',
  'settings',
  'password',
]);

const KNOWN_SCREENS = new Set([...PUBLIC_SCREENS, ...PROTECTED_SCREENS]);

const RESTORE_KEY = 'proofpath.navRestore.v1';
const VERIFY_RESULT_KEY = 'proofpath.verifyResult.v1';

function storage() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function cleanId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return '';
  return trimmed;
}

// Keep only the fields the history sync is allowed to persist. Unknown
// screens, tokens, passwords, files, and any extra keys are dropped.
export function sanitizeHistoryState(value) {
  if (!value || typeof value !== 'object') return null;
  const { screen, detailId, privacyReturn, deliveryOrigin } = value;
  if (typeof screen !== 'string' || !KNOWN_SCREENS.has(screen)) return null;
  const clean = { screen };
  const id = cleanId(detailId);
  if (id) clean.detailId = id;
  if (typeof privacyReturn === 'string' && KNOWN_SCREENS.has(privacyReturn) && privacyReturn !== 'privacy') {
    clean.privacyReturn = privacyReturn;
  }
  if (deliveryOrigin === 'saved' || deliveryOrigin === 'detail') {
    clean.deliveryOrigin = deliveryOrigin;
  }
  return clean;
}

export function isProtectedScreen(screen) {
  return PROTECTED_SCREENS.has(screen);
}

// Destination-specific return label for the Privacy & help screen.
export function privacyBackLabel(returnScreen) {
  if (returnScreen === 'signin') return 'Back to sign in';
  if (returnScreen === 'signup') return 'Back to create account';
  if (returnScreen === 'verify') return 'Back to verification';
  return 'Back to home';
}

// True when a verification token should be submitted: non-empty and not
// the token already attempted. Callers record the attempt synchronously
// before the async request so React StrictMode replays cannot resubmit.
export function shouldAttemptVerify(token, attemptedToken) {
  if (typeof token !== 'string' || !token.trim()) return false;
  return token !== attemptedToken;
}

function saveKey(key, value) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage failure must never break navigation.
  }
}

function readKey(key) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearKey(key) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // Ignore storage failures on cleanup.
  }
}

// Sanitized snapshot of the current history entry, or null when the entry
// carries no allowlisted navigation state.
export function readHistoryNav() {
  try {
    if (typeof window === 'undefined' || !window.history) return null;
    return sanitizeHistoryState(window.history.state);
  } catch {
    return null;
  }
}

export function saveNavRestore(state) {
  const clean = sanitizeHistoryState(state);
  if (!clean) return;
  saveKey(RESTORE_KEY, clean);
}

export function readNavRestore() {
  return sanitizeHistoryState(readKey(RESTORE_KEY));
}

export function clearNavRestore() {
  clearKey(RESTORE_KEY);
}

// Persisted verification *outcome* only ({status, error}), never the token.
// Lets a verified screen survive refresh without resubmitting anything.
export function saveVerifyResult(result) {
  if (!result || typeof result !== 'object') return;
  const clean = {};
  if (result.status === 'verified' || result.status === 'invalid') {
    clean.status = result.status;
  } else {
    return;
  }
  if (typeof result.error === 'string' && result.error) {
    clean.error = result.error.slice(0, 500);
  }
  saveKey(VERIFY_RESULT_KEY, clean);
}

export function readVerifyResult() {
  const parsed = readKey(VERIFY_RESULT_KEY);
  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.status !== 'verified' && parsed.status !== 'invalid') return null;
  const clean = { status: parsed.status };
  if (typeof parsed.error === 'string' && parsed.error) clean.error = parsed.error;
  return clean;
}

export function clearVerifyResult() {
  clearKey(VERIFY_RESULT_KEY);
}
