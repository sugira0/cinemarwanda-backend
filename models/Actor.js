const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
  name:      { type: String, required: true },
  bio:       { type: String },
  photo:     { type: String },
  birthDate: { type: String },
  birthPlace:{ type: String },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // linked user account
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likes:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  social: {
    instagram: { type: String },
    tiktok:    { type: String },
    twitter:   { type: String },
  },
}, { timestamps: true });

actorSchema.index({ name: 1 });
module.exports = mongoose.model('Actor', actorSchema);
