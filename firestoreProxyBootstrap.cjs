const expressModulePath = require.resolve('express');
const originalExpress = require(expressModulePath);
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'spartan-metric-tzp2g';
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-remixart-7582d439-4115-4be9-bd25-4bf656afcfac';
const COLLECTION = process.env.FIRESTORE_PROXY_COLLECTION || 'poultryData';
const SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

let firestore = null;
let initError = null;

function getAdminFirestore() {
  if (firestore) return firestore;
  if (!SERVICE_ACCOUNT_JSON) {
    initError = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
    return null;
  }

  try {
    let serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: cert({
            projectId: serviceAccount.project_id || PROJECT_ID,
            clientEmail: serviceAccount.client_email,
            privateKey: serviceAccount.private_key,
          }),
          projectId: serviceAccount.project_id || PROJECT_ID,
        });

    firestore = getFirestore(app, DATABASE_ID);
    initError = null;
    return firestore;
  } catch (error) {
    initError = error;
    console.error('[Firestore Proxy] Initialization failed:', error?.message || error);
    return null;
  }
}

function installFirestoreProxy(app) {
  // The application itself already uses express.json(); install a parser here because
  // this proxy is registered before the application's own middleware.
  app.use(originalExpress.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));

  app.get('/api/firestore/health', (_req, res) => {
    const db = getAdminFirestore();
    if (!db) {
      return res.status(503).json({
        status: 'error',
        configured: false,
        error: initError?.message || 'Firestore is not configured.',
      });
    }
    return res.json({
      status: 'ok',
      configured: true,
      projectId: PROJECT_ID,
      databaseId: DATABASE_ID,
      collection: COLLECTION,
    });
  });

  app.get('/api/firestore/:collectionName', async (req, res) => {
    if (req.params.collectionName !== COLLECTION) {
      return res.status(404).json({ error: 'Collection not found.' });
    }

    const db = getAdminFirestore();
    if (!db) {
      return res.status(503).json({ error: initError?.message || 'Firestore is not configured.' });
    }

    try {
      const snapshot = await db.collection(COLLECTION).get();
      return res.json({
        documents: snapshot.docs.map((item) => ({ id: item.id, data: item.data() })),
      });
    } catch (error) {
      console.error('[Firestore Proxy] Read collection failed:', error);
      return res.status(502).json({ error: error?.message || 'Firestore read failed.' });
    }
  });

  app.get('/api/firestore/:collectionName/:id', async (req, res) => {
    if (req.params.collectionName !== COLLECTION) {
      return res.status(404).json({ error: 'Collection not found.' });
    }

    const db = getAdminFirestore();
    if (!db) {
      return res.status(503).json({ error: initError?.message || 'Firestore is not configured.' });
    }

    try {
      const snapshot = await db.collection(COLLECTION).doc(req.params.id).get();
      return res.json({
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null,
      });
    } catch (error) {
      console.error('[Firestore Proxy] Read document failed:', error);
      return res.status(502).json({ error: error?.message || 'Firestore read failed.' });
    }
  });

  app.put('/api/firestore/:collectionName/:id', async (req, res) => {
    if (req.params.collectionName !== COLLECTION) {
      return res.status(404).json({ error: 'Collection not found.' });
    }

    const db = getAdminFirestore();
    if (!db) {
      return res.status(503).json({ error: initError?.message || 'Firestore is not configured.' });
    }

    try {
      await db.collection(COLLECTION).doc(req.params.id).set(req.body || {});
      return res.json({ ok: true });
    } catch (error) {
      console.error('[Firestore Proxy] Write document failed:', error);
      return res.status(502).json({ error: error?.message || 'Firestore write failed.' });
    }
  });
}

function patchedExpress(...args) {
  const app = originalExpress(...args);
  installFirestoreProxy(app);
  return app;
}

Object.setPrototypeOf(patchedExpress, originalExpress);
Object.assign(patchedExpress, originalExpress);
require.cache[expressModulePath].exports = patchedExpress;

console.log('[Firestore Proxy] Server-side Firestore transport loaded.');
