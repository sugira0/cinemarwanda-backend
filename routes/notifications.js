const router = require('express').Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { broadcastPush, sendPushToUsers } = require('../utils/pushNotification');

// ── GET my notifications ──────────────────────────────────────────────────────
router.get('/', protect, async (req, res) => {
  try {
    const notes = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(30);
    const unread = await Notification.countDocuments({ userId: req.user.id, read: false });
    res.json({ notifications: notes, unread });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH mark all read ───────────────────────────────────────────────────────
router.patch('/read', protect, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
    res.json({ message: 'All marked as read' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH mark one read ───────────────────────────────────────────────────────
router.patch('/:id/read', protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ message: 'Marked as read' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST register push token ──────────────────────────────────────────────────
// Called by mobile/web after getting FCM token
router.post('/push-token', protect, async (req, res) => {
  try {
    const { token, platform = 'android' } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Remove old entry for same token, then add fresh
    user.pushTokens = user.pushTokens.filter(pt => pt.token !== token);
    user.pushTokens.push({ token, platform, addedAt: new Date() });

    // Keep max 5 tokens per user
    if (user.pushTokens.length > 5) {
      user.pushTokens = user.pushTokens.slice(-5);
    }

    await user.save();
    res.json({ message: 'Push token registered.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── DELETE unregister push token ──────────────────────────────────────────────
router.delete('/push-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: 'Token is required.' });

    await User.findByIdAndUpdate(req.user.id, {
      $pull: { pushTokens: { token } },
    });
    res.json({ message: 'Push token removed.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST admin broadcast push ─────────────────────────────────────────────────
// Admin sends push to all users or by role
router.post('/broadcast', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, link = '', role = null } = req.body;
    if (!title || !message) {
      return res.status(400).json({ message: 'Title and message are required.' });
    }

    const result = await broadcastPush({
      title,
      body: message,
      type: 'system',
      link,
      role: role || null,
    });

    res.json({
      message: `Broadcast sent to ${result.sent} users.`,
      sent: result.sent,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
module.exports.sendPushToUsers = sendPushToUsers;
module.exports.broadcastPush = broadcastPush;
