const mongoose = require('mongoose');

const authOtpSchema = new mongoose.Schema({
  purpose: {
    type: String,
    enum: ['register', 'password_reset'],
    required: true,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  codeHash: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  attempts: {
    type: Number,
    default: 0,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, { timestamps: true });

authOtpSchema.index({ purpose: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('AuthOtp', authOtpSchema);
