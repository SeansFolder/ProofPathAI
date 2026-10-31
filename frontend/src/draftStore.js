// Persistent guest-draft store: draft metadata lives in localStorage while the
// evidence file (a Blob that cannot go into localStorage) lives in IndexedDB.
// Used to carry a guest's in-progress report across refresh, registration, the
// full-page verify/reset links, and sign-in. Cleared on save or fresh start.
const META_KEY = 'proofpath.pendingDraft.meta.v1';
const SCREEN_KEY = 'proofpath.pendingDraft.screen.v1';
const DB_NAME = 'proofpath';
const STORE_NAME = 'pendingDraft';
const FILE_KEY = 'evidence';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readMeta() {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } catch (error) {
      reject(error);
    }
  });
}

async function readFileRecord() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const get = tx.objectStore(STORE_NAME).get(FILE_KEY);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
    });
  } catch {
    return null;
  }
}

async function writeFileRecord(record) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record, FILE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFileRecord() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(FILE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Storage failure must never break the reporting flow.
  }
}

export function isDraftStoreAvailable() {
  try {
    return Boolean(window.localStorage) && Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

// Save a wizard snapshot. `snapshot.file` may be a File/Blob, null (leave the
// stored file untouched), or undefined (leave untouched).
export async function savePendingDraft(snapshot) {
  try {
    const { file, ...meta } = snapshot || {};
    if (file instanceof Blob) {
      await writeFileRecord({
        blob: file,
        name: file.name || 'evidence',
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
      });
    }
    window.localStorage.setItem(META_KEY, JSON.stringify({ ...meta, savedAt: Date.now() }));
  } catch {
    // Storage failure must never break the reporting flow.
  }
}

export async function loadPendingDraft() {
  const meta = readMeta();
  if (!meta) return null;
  const { savedAt, ...fields } = meta;
  const record = await readFileRecord();
  let file = null;
  if (record?.blob instanceof Blob) {
    try {
      file = new File([record.blob], record.name || 'evidence', {
        type: record.type || record.blob.type || 'application/octet-stream',
        lastModified: record.lastModified || Date.now(),
      });
    } catch {
      file = null;
    }
  }
  return { ...fields, file };
}

export function readDraftOwner() {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.ownerId !== 'undefined' ? parsed.ownerId : null;
  } catch {
    return null;
  }
}

export async function clearPendingDraft() {
  try {
    window.localStorage.removeItem(META_KEY);
    window.localStorage.removeItem(SCREEN_KEY);
  } catch {
    // Ignore storage failures on cleanup.
  }
  await deleteFileRecord();
}

// One-shot post-auth destination, persisted so a refresh or a full-page
// /?verify deep-link does not lose the signed-out "Create a report" entry.
// Allowlisted to {screen, category} only: never passwords, tokens, drafts,
// or other credentials. Cleared after use, on explicit cancel, or sign-out.
const POSTAUTH_KEY = 'proofpath.postAuth.v1';

export function savePostAuth(destination) {
  try {
    if (!destination || (destination.screen !== 'wizard' && destination.screen !== 'savegate')) {
      window.localStorage.removeItem(POSTAUTH_KEY);
      return;
    }
    const allowlisted = { screen: destination.screen };
    if (typeof destination.category === 'string' && destination.category) {
      allowlisted.category = destination.category;
    }
    window.localStorage.setItem(POSTAUTH_KEY, JSON.stringify(allowlisted));
  } catch {
    // Storage failure must never break the auth flow.
  }
}

export function readPostAuth() {
  try {
    const raw = window.localStorage.getItem(POSTAUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.screen !== 'wizard' && parsed.screen !== 'savegate')) return null;
    const destination = { screen: parsed.screen };
    if (typeof parsed.category === 'string' && parsed.category) destination.category = parsed.category;
    return destination;
  } catch {
    return null;
  }
}

export function clearPostAuth() {
  try {
    window.localStorage.removeItem(POSTAUTH_KEY);
  } catch {
    // Ignore storage failures on cleanup.
  }
}

// Non-sensitive auth-field memory: keeps typed identifiers/usernames across
// the Privacy & help round-trip (which unmounts the auth forms). Passwords
// are never written here.
const AUTH_FIELDS_KEY = 'proofpath.authFields.v1';

export function readAuthFields() {
  try {
    const raw = window.sessionStorage.getItem(AUTH_FIELDS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeAuthField(name, value) {
  try {
    const fields = readAuthFields();
    if (value) fields[name] = value;
    else delete fields[name];
    window.sessionStorage.setItem(AUTH_FIELDS_KEY, JSON.stringify(fields));
  } catch {
    // Storage failure must never break the auth flow.
  }
}

// Remembers which in-flow screen held the draft so a full-page reload can
// resume the wizard or the save gate instead of dropping the visitor.
export function markDraftScreen(screen) {
  try {
    if (screen === 'wizard' || screen === 'savegate') {
      window.localStorage.setItem(SCREEN_KEY, screen);
    } else {
      window.localStorage.removeItem(SCREEN_KEY);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function readDraftScreen() {
  try {
    const value = window.localStorage.getItem(SCREEN_KEY);
    return value === 'wizard' || value === 'savegate' ? value : '';
  } catch {
    return '';
  }
}
