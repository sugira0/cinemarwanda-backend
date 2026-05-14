const router   = require('express').Router();
const Presence = require('../models/Presence');
const { protect, adminOnly } = require('../middleware/auth');

// POST — user heartbeat (called every 30s from client)
router.post('/ping', protect, async (req, res) => {
  try {
    const { page, movieId, movieTitle, deviceId } = req.body;
    await Presence.findOneAndUpdate(
      { userId: req.user.id },
      {
        userId:     req.user.id,
        name:       req.body.name || 'User',
        deviceId,
        page:       page       || '/',
        movieId:    movieId    || null,
        movieTitle: movieTitle || null,
        lastSeen:   new Date(),
      },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE — user goes offline
router.delete('/ping', protect, async (req, res) => {
  try {
    await Presence.findOneAndDelete({ userId: req.user.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET — admin sees all online users
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const online   = await Presence.find({}).sort({ lastSeen: -1 });
    const watching = online.filter(p => p.movieId);
    res.json({ online: online.length, watching: watching.length, users: online });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
