const User = require('../models/User');
const { getFreeEpisodeCount } = require('./settings');
const { activeSubscription, getPlaybackEntitlement } = require('../utils/entitlements');

// Check if user has an active subscription (or is admin/author)
const requireSubscription = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Login required' });

    // Admins and authors always have access
    if (req.user.role === 'admin' || req.user.role === 'author') return next();

    const movieId = req.params.id || req.params.movieId;
    const episodeId = req.query.episodeId || req.params.episodeId || null;
    if (!movieId) return res.status(400).json({ message: 'Movie ID is required for authorization' });
    const entitlement = await getPlaybackEntitlement(req.user.id, movieId, episodeId, {
      consumeCredit: false,
    });
    if (entitlement.allowed) return next();

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
    if (activeSubscription(user)) return next();

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
