require('dotenv').config();
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const rawBucket = process.env.FIREBASE_STORAGE_BUCKET || '';
  const storageBucket = rawBucket.replace(/^gs:\/\//, '');

  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Railway / cloud: pass the full service-account JSON as a single env var
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Local dev: load from file (must be in .gitignore)
    // eslint-disable-next-line global-require
    const serviceAccount = require('../../firebase-admin-sdk.json');
    credential = admin.credential.cert(serviceAccount);
  }

  admin.initializeApp({
    credential,
    storageBucket: storageBucket || undefined,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();
const auth = admin.auth();
const messaging = admin.messaging();

module.exports = { admin, db, auth, bucket, messaging };
