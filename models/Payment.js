const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName:    { type: String },
  userEmail:   { type: String },
  plan:        { type: String, enum: ['episode', 'basic', 'standard', 'premium'], required: true },
  amount:      { type: Number, required: true }, // in RWF
  currency:    { type: String, default: 'RWF' },
  status:      { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
  method:      { type: String, enum: ['momo', 'card', 'airtel', 'manual'], default: 'manual' },
  reference:   { type: String, unique: true },  // payment reference/transaction ID
  expiresAt:   { type: Date },                  // subscription expiry
  notes:       { type: String },
}, { timestamps: true });

paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });
module.exports = mongoose.model('Payment', paymentSchema);
