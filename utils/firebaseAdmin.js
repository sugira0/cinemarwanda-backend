const admin = require('firebase-admin');

function privateKey() {
  return process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
}

function getCredential() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const key = privateKey();

  if (projectId && clientEmail && key) {
    return admin.credential.cert({ projectId, clientEmail, privateKey: key });
  }

  return admin.credential.applicationDefault();
}

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: getCredential(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }

  return admin;
}

async function verifyFirebaseIdToken(token) {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}

module.exports = { getFirebaseAdmin, verifyFirebaseIdToken };
