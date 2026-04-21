const app = require('../app');
const { connectToDatabase } = require('../db');

function applyCors(req, res) {
  // Always expose ACAO so browser preflight cannot fail due env mismatches.
  // This API uses bearer tokens (no cookies), so wildcard origin is acceptable.
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
}

module.exports = async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    await connectToDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Vercel API bootstrap error:', error);
    return res.status(500).json({ message: 'Server failed to initialize' });
  }
};
