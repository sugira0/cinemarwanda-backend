const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, '..', 'uploads');
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const videoExtensions = new Set(['.mp4', '.webm', '.ogg', '.mov', '.mkv']);

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

function sanitizeUploadName(filename) {
  return path.basename(filename || '');
}

function isRemoteMediaPath(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getUploadPath(filename) {
  if (isRemoteMediaPath(filename)) {
    return null;
  }

  const safeName = sanitizeUploadName(filename);
  return safeName ? path.join(uploadDir, safeName) : null;
}

function getUploadExtension(filename) {
  if (isRemoteMediaPath(filename)) {
    try {
      return path.extname(new URL(filename).pathname).toLowerCase();
    } catch {
      return '';
    }
  }

  return path.extname(sanitizeUploadName(filename)).toLowerCase();
}

function buildLocalUploadName(filename) {
  return `${Date.now()}-${crypto.randomUUID()}${path.extname(filename || '').toLowerCase()}`;
}

function isImageFile(filename) {
  return imageExtensions.has(getUploadExtension(filename));
}

function isVideoFile(filename) {
  return videoExtensions.has(getUploadExtension(filename));
}

module.exports = {
  buildLocalUploadName,
  ensureUploadDir,
  getUploadPath,
  isImageFile,
  isRemoteMediaPath,
  isVideoFile,
  sanitizeUploadName,
  uploadDir,
};
