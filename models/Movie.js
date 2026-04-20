const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  episode:  { type: Number, required: true },
  season:   { type: Number, default: 1 },
  videoUrl: { type: String },
  videoLink:{ type: String },  // external URL for episode
  duration: { type: String },
}, { timestamps: true });

const movieSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, required: true },
  genre:       [{ type: String }],
  year:        { type: Number },
  duration:    { type: String },
  language:    { type: String, default: 'Kinyarwanda' },
  poster:      { type: String },
  videoUrl:    { type: String },
  videoLink:   { type: String },
  trailerUrl:  { type: String },   // YouTube/Vimeo trailer shown in hero
  type:        { type: String, enum: ['movie', 'series'], default: 'movie' },
  episodes:    [episodeSchema],    // used when type === 'series'
  featured:    { type: Boolean, default: false },
  cast:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Actor' }],
  views:       { type: Number, default: 0 },
  viewedIPs:   [{ type: String }],
  authorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

// Indexes for fast queries
movieSchema.index({ featured: 1 });
movieSchema.index({ genre: 1 });
movieSchema.index({ type: 1 });
movieSchema.index({ views: -1 });
movieSchema.index({ createdAt: -1 });
movieSchema.index({ title: 'text', description: 'text' }, { default_language: 'none', language_override: 'lang_override' });

module.exports = mongoose.model('Movie', movieSchema);
