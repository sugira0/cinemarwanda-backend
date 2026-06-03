const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, unique: true, sparse: true, trim: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  phone: { type: String, unique: true, sparse: true, trim: true },
  password: { type: String },
  role: { type: String, enum: ['viewer', 'author', 'admin', 'actor'], default: 'viewer' },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  devices: [{
    deviceId: { type: String },
    deviceName: { type: String },
    lastSeen: { type: Date, default: Date.now },
    lastIp: { type: String },
    userAgent: { type: String },
    platform: { type: String },
    language: { type: String },
    location: {
      label: { type: String },
      city: { type: String },
      region: { type: String },
      country: { type: String },
      latitude: { type: Number },
      longitude: { type: Number },
      accuracy: { type: Number },
      timezone: { type: String },
      source: { type: String, enum: ['browser', 'network', 'unknown'], default: 'unknown' },
      capturedAt: { type: Date }
    }
  }],
  deviceRemovalVerification: {
    requestId: { type: String },
    deviceId: { type: String },
    emailCodeHash: { type: String },
    whatsappCodeHash: { type: String },
    email: { type: String },
    phone: { type: String },
    expiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    initiatedByDeviceId: { type: String },
    initiatedAt: { type: Date, default: Date.now }
  },
  watchlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Movie' }],
  purchasedContent: [{
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie' },
    episodeId: { type: String, default: null }, // null = full movie
    paidAt: { type: Date, default: Date.now },
    amount: { type: Number },
    reference: { type: String },
  }],
  // ── Push notification tokens (FCM) ────────────────────────────────────────
  pushTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
    addedAt: { type: Date, default: Date.now },
  }],
  resetToken: { type: String },
  resetTokenExpiry: { type: Date },
  subscription: {
    plan: { type: String, enum: ['free', 'basic', 'standard', 'premium'], default: 'free' },
    expiresAt: { type: Date },
    active: { type: Boolean, default: false }
  },
  // ── Watch progress (continue watching) ───────────────────────────────────
  watchProgress: [{
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    episodeId: { type: String, default: null }, // null = movie itself
    position: { type: Number, default: 0 },   // seconds from start
    duration: { type: Number, default: 0 },   // total duration in seconds
    updatedAt: { type: Date, default: Date.now },
    completed: { type: Boolean, default: false },
  }],
}, { timestamps: true });

// ── Indexes ───────────────────────────────────────────────────────────────────
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ 'subscription.active': 1 });
userSchema.index({ 'subscription.plan': 1 });
userSchema.index({ resetToken: 1 }, { sparse: true });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'watchProgress.movieId': 1 });

module.exports = mongoose.model('User', userSchema);
