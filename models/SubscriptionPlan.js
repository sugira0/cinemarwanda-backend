const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true, trim: true, lowercase: true }, // e.g. "basic", "gold"
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true, min: 0 },
  durationDays:{ type: Number, required: true, min: 1 },
  streams:     { type: Number, default: 1, min: 1 },   // concurrent streams allowed
  features:    [{ type: String }],                      // bullet points shown to users
  active:      { type: Boolean, default: true },        // inactive plans are hidden from users
  order:       { type: Number, default: 0 },            // display order
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
