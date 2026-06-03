const express = require('express');
const fs = require('fs');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { getUploadPath, isImageFile } = require('./utils/media');
const { maintenanceGuard } = require('./middleware/settings');

dotenv.config();

const app = express();

app.set('trust proxy', true);

// ── In-memory cache for hot read endpoints ────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = {
  short: 30 * 1000,
  medium: 2 * 60 * 1000,
  long: 10 * 60 * 1000,
};

function cacheMiddleware(ttl) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    // Don't cache authenticated requests (user-specific data)
    if (req.headers.authorization) return next();
    const key = req.originalUrl;
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) {
      res.set('X-Cache', 'HIT');
      return res.json(hit.data);
    }
    const origJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode === 200) _cache.set(key, { data, ts: Date.now() });
      return origJson(data);
    };
    next();
  };
}

// Prune stale cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of _cache.entries()) {
    if (now - val.ts > CACHE_TTL.long) _cache.delete(key);
  }
}, 5 * 60 * 1000).unref();

app.locals.cacheMiddleware = cacheMiddleware;
app.locals.CACHE_TTL = CACHE_TTL;

// ── Gzip compression for all responses ───────────────────────────────────────
app.use(compression({ level: 6, threshold: 1024 }));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false }, // we handle proxy trust ourselves
  message: { message: 'Too many requests, please try again later.' },
  skip: (req) => req.method === 'OPTIONS',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { message: 'Too many auth attempts, please try again later.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/firebase', authLimiter);

// ── Static uploads ────────────────────────────────────────────────────────────
function sendUploadedImage(req, res) {
  if (!isImageFile(req.params.filename)) {
    return res.status(404).json({ message: 'File not found' });
  }
  const filePath = getUploadPath(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(filePath);
}

app.get('/uploads/:filename', sendUploadedImage);
app.get('/api/uploads/:filename', sendUploadedImage);

// ── Request logger ────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', maintenanceGuard, cacheMiddleware(CACHE_TTL.medium), require('./routes/movies'));
app.use('/api/watchlist', maintenanceGuard, require('./routes/watchlist'));
app.use('/api/actors', maintenanceGuard, cacheMiddleware(CACHE_TTL.medium), require('./routes/actors'));
app.use('/api/comments', maintenanceGuard, require('./routes/comments'));
app.use('/api/notifications', maintenanceGuard, require('./routes/notifications'));
app.use('/api/analytics', maintenanceGuard, require('./routes/analytics'));
app.use('/api/payments', maintenanceGuard, require('./routes/payments'));
app.use('/api/users', maintenanceGuard, require('./routes/users'));
app.use('/api/streams', maintenanceGuard, require('./routes/streams'));
app.use('/api/settings', cacheMiddleware(CACHE_TTL.long), require('./routes/settings'));
app.use('/api/plans', cacheMiddleware(CACHE_TTL.long), require('./routes/plans'));
app.use('/api/presence', require('./routes/presence'));
app.use('/api/bulk', maintenanceGuard, require('./routes/bulk'));
app.use('/api/progress', maintenanceGuard, require('./routes/progress'));

app.get('/', (req, res) => res.json({ status: 'CINEMA Rwanda API running', version: '1.0' }));

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;
