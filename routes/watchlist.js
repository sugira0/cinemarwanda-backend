const router = require('express').Router();
const User   = require('../models/User');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('watchlist');
    res.json(user.watchlist);
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
    await User.findByIdAndUpdate(req.user.id, { $pull: { watchlist: req.params.movieId } });
    res.json({ message: 'Removed from watchlist' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
