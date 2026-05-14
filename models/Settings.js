const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

// Singleton helper — get or create a settings doc by key
settingsSchema.statics.get = async function (key, defaultValue) {
  const doc = await this.findOne({ key });
  if (doc) return doc.value;
  return defaultValue;
};

settingsSchema.statics.set = async function (key, value) {
  return this.findOneAndUpdate(
    { key },
    { value },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

module.exports = mongoose.model('Settings', settingsSchema);
