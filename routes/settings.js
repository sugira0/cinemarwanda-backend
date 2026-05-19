const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const Settings = require('../models/Settings');
const { protect, adminOnly } = require('../middleware/auth');
const { invalidateSettingsCache } = require('../middleware/settings');

// Default values — used when no settings doc exists yet
const DEFAULTS = {
  platform: {
    siteName:           'CINEMA Rwanda',
    freeEpisodes:       2,
    maintenanceMode:    false,
    allowRegistrations: true,
  },
  plans: {
    basic:    { price: 2000,  durationDays: 30 },
    standard: { price: 5000,  durationDays: 30 },
    premium:  { price: 10000, durationDays: 30 },
  },
  contact: {
    email:     'rwandancinema@gmail.com',
    whatsapp:  '+250 786 666 111',
    phone:     '+250 786 666 111',
    website:   'https://cinemarwanda.com',
  },
  notifications: {
    newReleases:           true,
    subscriptionReminders: true,
    promotions:            false,
    systemUpdates:         true,
  },
  content: {
    terms:     'By using CINEMA Rwanda, you agree to our terms of service. You may not reproduce, distribute, or create derivative works from our content without explicit permission.\n\nSubscriptions are billed monthly and can be cancelled at any time. Refunds are issued at our discretion.\n\nWe reserve the right to suspend accounts that violate our community guidelines.\n\nFor questions, contact rwandancinema@gmail.com',
    help:      'Frequently Asked Questions\n\n• How do I subscribe?\nGo to the Plans tab and choose a plan. Pay via MTN MoMo or Airtel Money.\n\n• Why can\'t I watch a film?\nYou need an active subscription. Episodes 1 & 2 of any series are free.\n\n• How do I cancel?\nSubscriptions expire automatically. Simply don\'t renew.\n\n• I paid but my plan isn\'t active?\nPayments are confirmed manually within 24 hours. Contact support if it takes longer.\n\n• How do I change my password?\nGo to Profile → Security → Change Password.',
    ownership: 'Your CINEMA Rwanda account is personal and non-transferable.\n\nYou are responsible for all activity on your account. Do not share your login credentials.\n\nIf you believe your account has been compromised, change your password immediately and contact support.\n\nAccounts are limited to 2 registered devices at a time.',
    invite:    'Join me on CINEMA Rwanda! Watch the best Rwandan movies & series.\n\nhttps://cinemarwanda.com',
  },
  languages: [
    { code: 'en', label: 'English (US)', native: 'English',      active: true  },
    { code: 'rw', label: 'Kinyarwanda',  native: 'Ikinyarwanda', active: true  },
    { code: 'fr', label: 'French',       native: 'Français',     active: true  },
    { code: 'sw', label: 'Swahili',      native: 'Kiswahili',    active: false },
  ],
};

// ── GET all settings ──────────────────────────────────────────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const [platform, plans, contact, notifications, content, languages] = await Promise.all([
      Settings.get('platform',      DEFAULTS.platform),
      Settings.get('plans',         DEFAULTS.plans),
      Settings.get('contact',       DEFAULTS.contact),
      Settings.get('notifications', DEFAULTS.notifications),
      Settings.get('content',       DEFAULTS.content),
      Settings.get('languages',     DEFAULTS.languages),
    ]);
    res.json({ platform, plans, contact, notifications, content, languages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH platform settings ───────────────────────────────────────────────────
router.patch('/platform', protect, adminOnly, async (req, res) => {
  try {
    const current = await Settings.get('platform', DEFAULTS.platform);
    const updated = {
      ...current,
      ...(req.body.siteName           !== undefined && { siteName:           String(req.body.siteName).trim() }),
      ...(req.body.freeEpisodes       !== undefined && { freeEpisodes:       Math.max(0, Number(req.body.freeEpisodes)) }),
      ...(req.body.maintenanceMode    !== undefined && { maintenanceMode:    Boolean(req.body.maintenanceMode) }),
      ...(req.body.allowRegistrations !== undefined && { allowRegistrations: Boolean(req.body.allowRegistrations) }),
    };
    await Settings.set('platform', updated);
    invalidateSettingsCache(); // clear cache so changes take effect immediately
    res.json({ message: 'Platform settings saved.', platform: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH plan prices ─────────────────────────────────────────────────────────
router.patch('/plans', protect, adminOnly, async (req, res) => {
  try {
    const current = await Settings.get('plans', DEFAULTS.plans);
    const updated = { ...current };

    for (const planId of ['basic', 'standard', 'premium']) {
      if (req.body[planId]) {
        const { price, durationDays } = req.body[planId];
        updated[planId] = {
          price:       price       !== undefined ? Math.max(0, Number(price))       : current[planId]?.price,
          durationDays: durationDays !== undefined ? Math.max(1, Number(durationDays)) : current[planId]?.durationDays,
        };
      }
    }

    await Settings.set('plans', updated);
    res.json({ message: 'Plan prices saved.', plans: updated });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Public endpoint — frontend reads free episode count & plan prices ─────────
router.get('/public', async (req, res) => {
  try {
    const [platform, plans, contact, notifications, content, languages] = await Promise.all([
      Settings.get('platform',      DEFAULTS.platform),
      Settings.get('plans',         DEFAULTS.plans),
      Settings.get('contact',       DEFAULTS.contact),
      Settings.get('notifications', DEFAULTS.notifications),
      Settings.get('content',       DEFAULTS.content),
      Settings.get('languages',     DEFAULTS.languages),
    ]);
    res.json({
      freeEpisodes:       platform.freeEpisodes       ?? DEFAULTS.platform.freeEpisodes,
      maintenanceMode:    platform.maintenanceMode     ?? false,
      allowRegistrations: platform.allowRegistrations  ?? true,
      siteName:           platform.siteName            ?? DEFAULTS.platform.siteName,
      plans,
      contact,
      notifications,
      content,
      languages: (languages || DEFAULTS.languages).filter(l => l.active),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH contact info ────────────────────────────────────────────────────────
router.patch('/contact', protect, adminOnly, async (req, res) => {
  try {
    const current = await Settings.get('contact', DEFAULTS.contact);
    const updated = { ...current, ...req.body };
    await Settings.set('contact', updated);
    res.json({ message: 'Contact info saved.', contact: updated });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH notification defaults ───────────────────────────────────────────────
router.patch('/notifications', protect, adminOnly, async (req, res) => {
  try {
    const current = await Settings.get('notifications', DEFAULTS.notifications);
    const updated = { ...current, ...req.body };
    await Settings.set('notifications', updated);
    res.json({ message: 'Notification defaults saved.', notifications: updated });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH static content ──────────────────────────────────────────────────────
router.patch('/content', protect, adminOnly, async (req, res) => {
  try {
    const current = await Settings.get('content', DEFAULTS.content);
    const updated = { ...current, ...req.body };
    await Settings.set('content', updated);
    res.json({ message: 'Content saved.', content: updated });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH languages ───────────────────────────────────────────────────────────
router.patch('/languages', protect, adminOnly, async (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ message: 'Languages must be an array.' });
    await Settings.set('languages', req.body);
    res.json({ message: 'Languages saved.', languages: req.body });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Support messages ──────────────────────────────────────────────────────────
const SupportMessage = require('../models/SupportMessage');

// POST — user sends a support message (authenticated or anonymous)
router.post('/support', async (req, res) => {
  try {
    const { message, name, email, phone } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: 'Message is required.' });

    // Try to get user from token if provided
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { resolveAuthToken } = require('../middleware/auth');
        const auth = await resolveAuthToken(authHeader.replace('Bearer ', ''));
        userId = auth?.userId || auth?.user?._id || null;
      } catch {}
    }

    const msg = await SupportMessage.create({ userId, message: message.trim(), name, email, phone });
    res.status(201).json({ message: 'Message sent. We\'ll get back to you within 24 hours.', id: msg._id });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET — admin reads all support messages
router.get('/support', protect, adminOnly, async (req, res) => {
  try {
    const { status, page = 1 } = req.query;
    const query = status ? { status } : {};
    const total = await SupportMessage.countDocuments(query);
    const messages = await SupportMessage.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20).limit(20)
      .populate('userId', 'name email phone');
    res.json({ messages, total, pages: Math.ceil(total / 20) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PATCH — admin marks as read or replies
router.patch('/support/:id', protect, adminOnly, async (req, res) => {
  try {
    const { status, reply } = req.body;
    const msg = await SupportMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Message not found.' });
    if (status) msg.status = status;
    if (reply)  { msg.reply = reply; msg.repliedAt = new Date(); msg.status = 'replied'; }
    await msg.save();
    res.json({ message: 'Updated.', supportMessage: msg });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE — admin deletes a message
router.delete('/support/:id', protect, adminOnly, async (req, res) => {
  try {
    await SupportMessage.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
module.exports.DEFAULTS = DEFAULTS;
