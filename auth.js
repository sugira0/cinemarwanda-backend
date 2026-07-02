require('dotenv').config();
const { betterAuth } = require('better-auth');
const { mongodbAdapter } = require('better-auth/adapters/mongodb');
const { MongoClient } = require('mongodb');

let _client = null;
async function getMongoClient() {
  if (_client) return _client;
  _client = new MongoClient(process.env.MONGO_URI);
  await _client.connect();
  return _client;
}

let _auth = null;

async function getAuth() {
  if (_auth) return _auth;

  const client = await getMongoClient();
  const db = client.db();

  const baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:5000';
  const secret = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || 'fallback_secret';

  _auth = betterAuth({
    database: mongodbAdapter(db),
    baseURL,
    secret,

    trustedOrigins: [
      'http://localhost:5173',
      'http://localhost:8081',
      'https://cinemarwanda.com',
      'https://www.cinemarwanda.com',
      'https://admin.cinemarwanda.com',
      'https://cinemarwandafront-end.vercel.app',
      'https://admin-cinemarwanda.vercel.app',
      'https://cinemarwanda-backend.onrender.com',
      'https://auth.expo.io',
    ],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 6,
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24,
    },

    user: {
      additionalFields: {
        phone: { type: 'string', required: false, defaultValue: '' },
        role: { type: 'string', required: false, defaultValue: 'viewer' },
        status: { type: 'string', required: false, defaultValue: 'active' },
      },
    },
  });

  return _auth;
}

module.exports = { getAuth };
