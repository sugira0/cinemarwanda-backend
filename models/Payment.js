const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:    { type: String },
  userEmail:   { type: String },
  plan:        { type: String, required: true }, // 'basic','standard','premium','weekly','ppv', or any custom plan id
  amount:      { type: Number, required: true },
  currency:    { type: String, default: 'RWF' },
  status:      { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
  method:      { type: String, enum: ['momo', 'card', 'airtel', 'manual'], default: 'manual' },
  reference:   { type: String, unique: true },
  expiresAt:   { type: Date },
  // PPV-specific
  movieId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', default: null },
  episodeId:   { type: String, default: null },
  entitlementGrantedAt: { type: Date, default: null },
  notes:       { type: String },
}, { timestamps: true });

paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });
module.exports = mongoose.model('Payment', paymentSchema);
