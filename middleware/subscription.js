const User = require('../models/User');
const { getFreeEpisodeCount } = require('./settings');

// Check if user has an active subscription (or is admin/author)
const requireSubscription = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Login required' });

    // Admins and authors always have access
    if (req.user.role === 'admin' || req.user.role === 'author') return next();

    const user = await User.findById(req.user.id).select('subscription role purchasedContent');
    if (!user) return res.status(401).json({ message: 'User not found' });

    const sub = user.subscription;
    const isActive = sub?.active && sub?.expiresAt && new Date(sub.expiresAt) > new Date();

    if (isActive) return next();

    // Check if this is a PPV purchased movie
    const movieId = req.params.id;
    const episodeId = req.query.episodeId || null;
    if (movieId && user.purchasedContent?.length) {
      const purchased = user.purchasedContent.find(p =>
        String(p.movieId) === String(movieId) &&
        (p.episodeId === null || p.episodeId === episodeId)
      );
      if (purchased) return next();
    }

    return res.status(403).json({
      message: 'Subscription required',
      code: 'NO_SUBSCRIPTION',
      plans: '/plans',
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Check if episode is within the free episode limit from settings
const checkFreeEpisode = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Login required' });
    if (req.user.role === 'admin' || req.user.role === 'author') return next();

    const user = await User.findById(req.user.id).select('subscription');
    const sub = user?.subscription;
    const isActive = sub?.active && sub?.expiresAt && new Date(sub.expiresAt) > new Date();
    if (isActive) return next();

    // Get episode number from query or body
    const episodeNum = Number(req.query.episode || req.body?.episode || 1);
    const freeLimit = await getFreeEpisodeCount();

    if (episodeNum <= freeLimit) return next();

    return res.status(403).json({
      message: `Episodes ${freeLimit + 1}+ require a subscription.`,
      code: 'NO_SUBSCRIPTION',
      freeEpisodes: freeLimit,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { requireSubscription, checkFreeEpisode };
