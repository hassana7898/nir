type ProxyDb = { __firestoreProxy: true };
type DocRef = { __type: 'doc'; collection: string; id: string };
type CollectionRef = { __type: 'collection'; collection: string };

type SnapshotDoc = { id: string; data: () => any; exists: () => boolean };

const API_BASE = '/api/firestore';
const POLL_MS = 30000;

const request = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    let message = `Firestore proxy request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }

  return response.json();
};

export const getFirestore = (..._args: any[]): ProxyDb => ({ __firestoreProxy: true });

export const doc = (_db: any, collectionName: string, id: string): DocRef => ({
  __type: 'doc',
  collection: collectionName,
  id,
});

export const collection = (_db: any, collectionName: string): CollectionRef => ({
  __type: 'collection',
  collection: collectionName,
});

export const setDoc = async (ref: DocRef, data: any, _options?: any): Promise<void> => {
  await request(`${API_BASE}/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
};

export const getDoc = async (ref: DocRef): Promise<SnapshotDoc> => {
  const result = await request(`${API_BASE}/${encodeURIComponent(ref.collection)}/${encodeURIComponent(ref.id)}`);
  return {
    id: ref.id,
    exists: () => Boolean(result?.exists),
    data: () => result?.data,
  };
};

export const getDocs = async (ref: CollectionRef) => {
  const result = await request(`${API_BASE}/${encodeURIComponent(ref.collection)}`);
  const documents = Array.isArray(result?.documents) ? result.documents : [];
  return {
    docs: documents.map((item: any) => ({
      id: item.id,
      data: () => item.data,
      exists: () => true,
    })),
    forEach(callback: (doc: SnapshotDoc) => void) {
      this.docs.forEach(callback);
    },
  };
};

export const onSnapshot = (
  ref: DocRef | CollectionRef,
  next: (snapshot: any) => void,
  error?: (error: unknown) => void,
): (() => void) => {
  let stopped = false;
  let previous = new Map<string, string>();

  const emit = async () => {
    if (stopped) return;
    try {
      if (ref.__type === 'doc') {
        const snapshot = await getDoc(ref);
        if (!stopped) next(snapshot);
        return;
      }

      const snapshot = await getDocs(ref);
      const changes: any[] = [];
      const current = new Map<string, string>();

      snapshot.docs.forEach((item: any) => {
        const serialized = JSON.stringify(item.data());
        current.set(item.id, serialized);
        const old = previous.get(item.id);
        changes.push({
          type: old === undefined ? 'added' : old !== serialized ? 'modified' : 'unchanged',
          doc: item,
        });
      });

      previous = current;
      next({
        docs: snapshot.docs,
        docChanges: () => changes.filter((change) => change.type !== 'unchanged'),
      });
    } catch (err) {
      if (!stopped) error?.(err);
    }
  };

  void emit();
  const timer = window.setInterval(emit, POLL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
};
