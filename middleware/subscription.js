const User = require('../models/User');

// Check if user has an active subscription (or is admin/author)
const requireSubscription = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Login required' });

    // Admins and authors always have access
    if (req.user.role === 'admin' || req.user.role === 'author') return next();

    const user = await User.findById(req.user.id).select('subscription role');
    if (!user) return res.status(401).json({ message: 'User not found' });

    const sub = user.subscription;
    const isActive = sub?.active && sub?.expiresAt && new Date(sub.expiresAt) > new Date();

    if (!isActive) {
      return res.status(403).json({
        message: 'Subscription required',
        code: 'NO_SUBSCRIPTION',
        plans: '/plans'
      });
    }

    next();
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { requireSubscription };
