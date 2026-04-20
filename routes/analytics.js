const router  = require('express').Router();
const Movie   = require('../models/Movie');
const User    = require('../models/User');
const Comment = require('../models/Comment');
const Payment = require('../models/Payment');
const Actor   = require('../models/Actor');
const { protect, adminOnly } = require('../middleware/auth');
const { publicContact, sanitizeEmail } = require('../utils/authContact');

function serializeUser(user) {
  const payload = user?.toObject ? user.toObject() : { ...user };
  payload.email = sanitizeEmail(payload.email);
  payload.phone = payload.phone || null;
  payload.contact = publicContact(payload);
  return payload;
}

function serializePayment(payment) {
  const payload = payment?.toObject ? payment.toObject() : { ...payment };
  if (payload.userId) {
    payload.userId = serializeUser(payload.userId);
  }
  return payload;
}

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const [
      totalMovies, totalUsers, totalComments,
      topMovies, recentUsers, genreStats,
      totalRevenue, pendingPayments, recentPayments,
      totalViewsStats, paidUsers, topActors
    ] = await Promise.all([
      Movie.countDocuments(),
      User.countDocuments(),
      Comment.countDocuments(),
      Movie.find().sort({ views: -1, createdAt: -1 }).limit(10).select('title views poster type'),
      User.find().sort({ createdAt: -1 }).limit(5).select('name email phone role createdAt'),
      Movie.aggregate([
        { $unwind: '$genre' },
        { $group: { _id: '$genre', count: { $sum: 1 }, views: { $sum: '$views' } } },
        { $sort: { views: -1 } }
      ]),
      Payment.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Payment.countDocuments({ status: 'pending' }),
      Payment.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'name email phone'),
      // Paid users — active subscriptions
      User.find({ 'subscription.active': true, 'subscription.expiresAt': { $gt: new Date() } })
          .select('name email phone subscription.plan subscription.expiresAt')
          .sort({ 'subscription.expiresAt': -1 })
          .limit(20),
      // Top followed actors
      Actor.aggregate([
        { $project: { name: 1, photo: 1, followersCount: { $size: '$followers' }, likesCount: { $size: '$likes' } } },
        { $sort: { followersCount: -1 } },
        { $limit: 5 }
      ])
    ]);

    const totalViews = topMovies.reduce((s, m) => s + (m.views || 0), 0);

    res.json({
      totalMovies, totalUsers, totalComments, totalViews,
      totalRevenue:    totalRevenue[0]?.total || 0,
      pendingPayments,
      topMovies,
      recentUsers: recentUsers.map(serializeUser),
      genreStats,
      recentPayments: recentPayments.map(serializePayment),
      paidUsers: paidUsers.map(serializeUser),
      topActors
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
