const User = require('../models/User');
const Payment = require('../models/Payment');

const STREAM_LIMITS = { basic: 1, standard: 2, premium: 4, weekly: 2 };

function sameContent(purchase, movieId, episodeId = null) {
  return String(purchase.movieId) === String(movieId)
    && String(purchase.episodeId || '') === String(episodeId || '');
}

function activeSubscription(user) {
  const subscription = user?.subscription;
  return Boolean(
    subscription?.active
    && subscription?.expiresAt
    && new Date(subscription.expiresAt) > new Date()
    && STREAM_LIMITS[subscription.plan]
  );
}

function inspectEntitlement(user, movieId, episodeId = null) {
  if (!user) return { allowed: false, code: 'USER_NOT_FOUND' };
  if (user.role === 'admin' || user.role === 'author') {
    return { allowed: true, source: 'role', plan: user.role, limit: 4 };
  }
  if (activeSubscription(user)) {
    return {
      allowed: true,
      source: 'subscription',
      plan: user.subscription.plan,
      limit: STREAM_LIMITS[user.subscription.plan],
    };
  }
  if (user.purchasedContent?.some((purchase) => sameContent(purchase, movieId, episodeId))) {
    return { allowed: true, source: 'purchase', plan: 'purchased', limit: 1 };
  }
  return { allowed: false, code: 'NO_ENTITLEMENT' };
}

async function getPlaybackEntitlement(userId, movieId, episodeId = null, { consumeCredit = false } = {}) {
  let user = await User.findById(userId)
    .select('role subscription purchasedContent episodeCredits');
  const existing = inspectEntitlement(user, movieId, episodeId);
  if (existing.allowed || !user) return existing;

  // Repair historical PPV confirmations that marked the payment completed but
  // did not copy the exact title into purchasedContent.
  const paidPurchase = await Payment.findOne({
    userId,
    status: 'completed',
    plan: 'ppv',
    movieId,
    episodeId: episodeId || null,
  }).select('amount reference');
  if (paidPurchase) {
    await User.findByIdAndUpdate(userId, {
      $push: {
        purchasedContent: {
          movieId,
          episodeId: episodeId || null,
          paidAt: new Date(),
          amount: paidPurchase.amount,
          reference: paidPurchase.reference,
        },
      },
    });
    return { allowed: true, source: 'purchase_recovered', plan: 'purchased', limit: 1 };
  }

  if (!consumeCredit) return existing;

  // Older MTN callbacks stored a 7-pack as an active pseudo-subscription
  // instead of issuing its credits. Convert that legacy state exactly once.
  if (
    user.episodeCredits <= 0
    && user.subscription?.plan === 'episodes7'
    && user.subscription?.active
    && user.subscription?.expiresAt
    && new Date(user.subscription.expiresAt) > new Date()
    && !user.purchasedContent?.some((purchase) => purchase.reference === 'EPISODE_CREDIT')
  ) {
    user = await User.findOneAndUpdate(
      {
        _id: userId,
        episodeCredits: 0,
        'subscription.plan': 'episodes7',
        'subscription.active': true,
      },
      {
        $set: { episodeCredits: 7, subscription: { plan: 'free', active: false, expiresAt: null } },
      },
      { new: true },
    ).select('role subscription purchasedContent episodeCredits');
  }

  if (!user || user.episodeCredits <= 0) return existing;

  const contentMatch = {
    movieId,
    episodeId: episodeId || null,
  };
  user = await User.findOneAndUpdate(
    {
      _id: userId,
      episodeCredits: { $gt: 0 },
      purchasedContent: { $not: { $elemMatch: contentMatch } },
    },
    {
      $inc: { episodeCredits: -1 },
      $push: {
        purchasedContent: {
          movieId,
          episodeId: episodeId || null,
          paidAt: new Date(),
          amount: 0,
          reference: 'EPISODE_CREDIT',
        },
      },
    },
    { new: true },
  ).select('role subscription purchasedContent episodeCredits');

  if (user) {
    return {
      allowed: true,
      source: 'episode_credit',
      plan: 'episodes7',
      limit: 1,
      creditsRemaining: user.episodeCredits,
    };
  }

  // A concurrent request may have unlocked the same content first.
  user = await User.findById(userId).select('role subscription purchasedContent episodeCredits');
  return inspectEntitlement(user, movieId, episodeId);
}

module.exports = { activeSubscription, getPlaybackEntitlement, inspectEntitlement };
