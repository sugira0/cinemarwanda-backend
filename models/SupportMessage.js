const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name:     { type: String },
  email:    { type: String },
  phone:    { type: String },
  message:  { type: String, required: true },
  status:   { type: String, enum: ['unread', 'read', 'replied'], default: 'unread' },
  reply:    { type: String },
  repliedAt:{ type: Date },
}, { timestamps: true });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
