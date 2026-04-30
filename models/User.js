const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid:{ type: String, unique: true, sparse: true, trim: true },
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true, trim: true, lowercase: true },
  phone:    { type: String, unique: true, sparse: true, trim: true },
  password: { type: String },
  role:     { type: String, enum: ['viewer', 'author', 'admin', 'actor'], default: 'viewer' },
  status:   { type: String, enum: ['active', 'suspended'], default: 'active' },
  devices:  [{
    deviceId:  { type: String },
    deviceName:{ type: String },
    lastSeen:  { type: Date, default: Date.now },
    lastIp:    { type: String },
    userAgent: { type: String },
    platform:  { type: String },
    language:  { type: String },
    location:  {
      label:      { type: String },
      city:       { type: String },
      region:     { type: String },
      country:    { type: String },
      latitude:   { type: Number },
      longitude:  { type: Number },
      accuracy:   { type: Number },
      timezone:   { type: String },
      source:     { type: String, enum: ['browser', 'network', 'unknown'], default: 'unknown' },
      capturedAt: { type: Date }
    }
  }],
  deviceRemovalVerification: {
    requestId:         { type: String },
    deviceId:          { type: String },
    emailCodeHash:     { type: String },
    whatsappCodeHash:  { type: String },
    email:             { type: String },
    phone:             { type: String },
    expiresAt:         { type: Date },
    attempts:          { type: Number, default: 0 },
    initiatedByDeviceId:{ type: String },
    initiatedAt:       { type: Date, default: Date.now }
  },
  watchlist:[{ type: mongoose.Schema.Types.ObjectId, ref: 'Movie' }],
  resetToken:       { type: String },
  resetTokenExpiry: { type: Date },
  subscription: {
    plan:      { type: String, enum: ['free', 'basic', 'standard', 'premium'], default: 'free' },
    expiresAt: { type: Date },
    active:    { type: Boolean, default: false }
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
