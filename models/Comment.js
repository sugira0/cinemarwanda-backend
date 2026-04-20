const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name:    { type: String, required: true },
  text:    { type: String, required: true },
  rating:  { type: Number, min: 1, max: 5 },
  likes:   [{ type: String }],
}, { timestamps: true });

commentSchema.index({ movieId: 1, createdAt: -1 });
module.exports = mongoose.model('Comment', commentSchema);
