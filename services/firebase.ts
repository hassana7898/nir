// Firebase is no longer used by NIR.
// This compatibility module is kept because older application modules
// still import `db` from this path. Actual persistence is handled by the
// local PostgreSQL server through services/firestoreProxy.ts.
export const app = null;
export const db = { __postgresStorage: true };
