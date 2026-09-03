type ProxyDb = { __postgresStorage: true };
type DocRef = { __type: 'doc'; collection: string; id: string };
type CollectionRef = { __type: 'collection'; collection: string };
type SnapshotDoc = { id: string; data: () => any; exists: () => boolean };

const API_BASE = '/api/storage';
const CLOUD_API_BASE = (import.meta as any).env?.VITE_CLOUD_STORAGE_URL?.replace(/\/$/, '') || '';
const POLL_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

const request = async (url: string, options?: RequestInit, credentials: RequestCredentials = 'same-origin') => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
      credentials,
    });
    if (!response.ok) {
      let message = `Storage request failed (${response.status})`;
      try { const body = await response.json(); if (body?.error) message = body.error; } catch {}
      throw new Error(message);
    }
    return response.json();
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('Storage server request timed out.');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const cloudRequest = async (path: string, options?: RequestInit) => {
  if (!CLOUD_API_BASE) throw new Error('Cloud storage URL is not configured');
  return request(`${CLOUD_API_BASE}${path}`, options, 'include');
};

const withCloudFallback = async (path: string, options?: RequestInit) => {
  try {
    return await request(`${API_BASE}${path}`, options, 'same-origin');
  } catch (localError) {
    if (!CLOUD_API_BASE) throw localError;
    console.warn('Local server unavailable; using cloud replica.', localError);
    return cloudRequest(path, { ...options, method: options?.method === 'PUT' ? 'GET' : options?.method });
  }
};

export const getFirestore = (..._args: any[]): ProxyDb => ({ __postgresStorage: true });
export const doc = (_db: any, collectionName: string, id: string): DocRef => ({ __type: 'doc', collection: collectionName, id });
export const collection = (_db: any, collectionName: string): CollectionRef => ({ __type: 'collection', collection: collectionName });

export const setDoc = async (ref: DocRef, data: any, _options?: any): Promise<void> => {
  // Local PostgreSQL remains the single writable master. The cloud side is a replica.
  await request(`${API_BASE}/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`, {
    method: 'PUT', body: JSON.stringify(data),
  });
};

export const getDoc = async (ref: DocRef): Promise<SnapshotDoc> => {
  const path = `/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`;
  const result = await withCloudFallback(path);
  return { id: ref.id, exists: () => Boolean(result?.exists), data: () => result?.data };
};

export const getDocs = async (ref: CollectionRef) => {
  const path = `/${encodeURIComponent(ref.collection)}`;
  let result: any;
  try {
    result = await request(`${API_BASE}${path}`);
  } catch (localError) {
    if (!CLOUD_API_BASE) throw localError;
    console.warn('Local server unavailable; loading latest cloud snapshot.', localError);
    result = await cloudRequest(path);
  }

  let documents = Array.isArray(result?.documents) ? result.documents : [];

  // First-device migration: if PostgreSQL is empty but this browser already has
  // local data from the old version, copy that data to the central database.
  if (documents.length === 0 && typeof window !== 'undefined' && window.localStorage.length > 0) {
    const migrated: any[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const value = window.localStorage.getItem(key);
      if (value === null) continue;
      try {
        await setDoc({ __type: 'doc', collection: ref.collection, id: key }, { value });
        migrated.push({ id: key, data: { value } });
      } catch (error) { console.error('Local data migration failed for key', key, error); }
    }
    if (migrated.length) documents = migrated;
  }

  const docs = documents.map((item: any) => ({ id: item.id, data: () => item.data, exists: () => true }));
  return { docs, forEach(callback: (doc: SnapshotDoc) => void) { docs.forEach(callback); } };
};

export const onSnapshot = (ref: DocRef | CollectionRef, next: (snapshot: any) => void, error?: (error: unknown) => void): (() => void) => {
  let stopped = false;
  let previous = new Map<string, string>();
  const emit = async () => {
    if (stopped) return;
    try {
      if (ref.__type === 'doc') { const snapshot = await getDoc(ref); if (!stopped) next(snapshot); return; }
      const snapshot = await getDocs(ref);
      const changes: any[] = [];
      const current = new Map<string, string>();
      snapshot.docs.forEach((item: any) => {
        const serialized = JSON.stringify(item.data()); current.set(item.id, serialized);
        const old = previous.get(item.id);
        changes.push({ type: old === undefined ? 'added' : old !== serialized ? 'modified' : 'unchanged', doc: item });
      });
      previous = current;
      next({ docs: snapshot.docs, docChanges: () => changes.filter(c => c.type !== 'unchanged') });
    } catch (err) { if (!stopped) error?.(err); }
  };
  void emit();
  const timer = window.setInterval(emit, POLL_MS);
  return () => { stopped = true; window.clearInterval(timer); };
};
