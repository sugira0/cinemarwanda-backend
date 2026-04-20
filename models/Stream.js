const mongoose = require('mongoose');

// Tracks active streams — expires automatically after 4 hours of inactivity
const streamSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  movieId:   { type: String, required: true },
  deviceId:  { type: String },
  startedAt: { type: Date, default: Date.now },
  lastPing:  { type: Date, default: Date.now },
  // TTL index — auto-delete after 4 hours of no ping
}, { timestamps: false });

streamSchema.index({ lastPing: 1 }, { expireAfterSeconds: 14400 }); // 4 hours
streamSchema.index({ userId: 1 });

module.exports = mongoose.model('Stream', streamSchema);
