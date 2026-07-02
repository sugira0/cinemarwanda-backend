const mongoose = require('mongoose');

const songSchema = new mongoose.Schema({
    title: { type: String, required: true },
    artist: { type: String, required: true },
    album: { type: String, default: '' },
    genre: [{ type: String }],
    year: { type: Number },
    language: { type: String, default: 'Kinyarwanda' },
    country: { type: String, default: 'Rwanda' },
    cover: { type: String },          // Cloudinary image URL
    audioUrl: { type: String },          // Cloudinary audio URL
    audioLink: { type: String },          // External audio URL
    duration: { type: Number, default: 0 }, // seconds
    featured: { type: Boolean, default: false },
    plays: { type: Number, default: 0 },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

songSchema.index({ featured: 1 });
songSchema.index({ genre: 1 });
songSchema.index({ plays: -1 });
songSchema.index({ createdAt: -1 });
songSchema.index({ authorId: 1, createdAt: -1 });
songSchema.index({ title: 'text', artist: 'text', album: 'text' }, { default_language: 'none', language_override: 'lang_override' });

module.exports = mongoose.model('Song', songSchema);
