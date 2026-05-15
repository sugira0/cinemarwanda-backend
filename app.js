const express = require('express');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const { toNodeHandler } = require('better-auth/node');
const { getAuth } = require('./auth');
const { getUploadPath, isImageFile } = require('./utils/media');

dotenv.config();

const app = express();

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:3000',
  'https://cinemarwandafront-end.vercel.app',
];

app.set('trust proxy', true);

// ── CORS — must allow credentials for Better Auth cookie sessions ─────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, true); // allow all for now; tighten in production
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json());

// ── Better Auth handler — must come BEFORE express.json for some routes ───────
app.all('/api/auth/*', async (req, res) => {
  try {
    const auth = await getAuth();
    return toNodeHandler(auth)(req, res);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function sendUploadedImage(req, res) {
  if (!isImageFile(req.params.filename)) {
    return res.status(404).json({ message: 'File not found' });
  }

  const filePath = getUploadPath(req.params.filename);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }

  return res.sendFile(filePath);
}

app.get('/uploads/:filename', sendUploadedImage);
app.get('/api/uploads/:filename', sendUploadedImage);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ── Custom auth routes (OTP registration, login, device management) ───────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/actors', require('./routes/actors'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/streams', require('./routes/streams'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/plans',    require('./routes/plans'));
app.use('/api/presence', require('./routes/presence'));

app.get('/', (req, res) => res.json({ status: 'CINEMA Rwanda API running', version: '1.0' }));

module.exports = app;
