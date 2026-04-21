const app = require('../app');
const { connectToDatabase } = require('../db');

function applyCors(req, res) {
  const requestOrigin = req.headers.origin || '';
  const allowedOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  function isAllowedOrigin(origin) {
    if (!origin) return false;
    if (!allowedOrigins.length) return true;
    if (allowedOrigins.includes('*')) return true;
    if (allowedOrigins.includes(origin)) return true;

    try {
      const url = new URL(origin);
      const localhostWildcard =
        allowedOrigins.includes(`${url.protocol}//localhost`) ||
        allowedOrigins.includes(`${url.protocol}//localhost:*`) ||
        allowedOrigins.includes(`${url.protocol}//127.0.0.1`) ||
        allowedOrigins.includes(`${url.protocol}//127.0.0.1:*`);

      return (
        localhostWildcard &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      );
    } catch {
      return false;
    }
  }

  if (!allowedOrigins.length || allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && isAllowedOrigin(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }

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
