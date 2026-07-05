const router = require('express').Router();
const User   = require('../models/User');
const { protect } = require('../middleware/auth');

function targetUserId(req) {
  const requestedId = req.query.userId;
  return requestedId && req.user.role === 'admin' ? requestedId : req.user.id;
}

router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(targetUserId(req)).populate('watchlist');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user.watchlist || []);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/:movieId', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $addToSet: { watchlist: req.params.movieId } });
    res.json({ message: 'Added to watchlist' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:movieId', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(targetUserId(req), { $pull: { watchlist: req.params.movieId } });
    res.json({ message: 'Removed from watchlist' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
