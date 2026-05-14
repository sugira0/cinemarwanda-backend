const mongoose = require('mongoose');

const presenceSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name:      { type: String },
  deviceId:  { type: String },
  page:      { type: String, default: '/' },
  movieId:   { type: String },
  movieTitle:{ type: String },
  lastSeen:  { type: Date, default: Date.now },
}, { timestamps: false });

// Auto-delete after 2 minutes of no ping
presenceSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 120 });

module.exports = mongoose.model('Presence', presenceSchema);
