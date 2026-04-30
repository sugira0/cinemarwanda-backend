const express = require('express');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const { getUploadPath, isImageFile } = require('./utils/media');

dotenv.config();

const app = express();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

app.set('trust proxy', true);
app.use((req, res, next) => {
  Object.entries(corsHeaders).forEach(([header, value]) => {
    res.setHeader(header, value);
  });
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  return next();
});
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());

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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/movies', require('./routes/movies'));
app.use('/api/watchlist', require('./routes/watchlist'));
app.use('/api/actors', require('./routes/actors'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/streams', require('./routes/streams'));

app.get('/', (req, res) => res.json({ status: 'CINEMA Rwanda API running', version: '1.0' }));

module.exports = app;
