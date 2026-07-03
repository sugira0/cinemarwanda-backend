const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const User = require('../models/User');

const RECURRING_PLANS = new Set(['basic', 'standard', 'premium', 'weekly']);
const DEFAULT_DURATION_DAYS = { basic: 30, standard: 30, premium: 30, weekly: 7 };

function paymentDurationMs(payment) {
  const recorded = payment.expiresAt && payment.createdAt
    ? new Date(payment.expiresAt).getTime() - new Date(payment.createdAt).getTime()
    : 0;
  if (recorded > 0) return recorded;
  return (DEFAULT_DURATION_DAYS[payment.plan] || 30) * 24 * 60 * 60 * 1000;
}

async function grantCompletedPayment(paymentId) {
  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);
      if (!payment) throw new Error('Payment not found');
      if (payment.status !== 'completed') throw new Error('Only completed payments can grant access');
      if (payment.entitlementGrantedAt) {
        result = { granted: false, alreadyGranted: true, plan: payment.plan };
        return;
      }

      const user = await User.findById(payment.userId).session(session);
      if (!user) throw new Error('Payment user not found');

      if (payment.plan === 'ppv' && payment.movieId) {
        const alreadyPurchased = user.purchasedContent?.some((purchase) => (
          String(purchase.movieId) === String(payment.movieId)
          && String(purchase.episodeId || '') === String(payment.episodeId || '')
        ));
        if (!alreadyPurchased) {
          user.purchasedContent.push({
            movieId: payment.movieId,
            episodeId: payment.episodeId || null,
            paidAt: new Date(),
            amount: payment.amount,
            reference: payment.reference,
          });
        }
        result = { granted: true, type: 'content', plan: payment.plan };
      } else if (payment.plan === 'ppv') {
        user.episodeCredits = (user.episodeCredits || 0) + 1;
        result = { granted: true, type: 'credits', creditsAdded: 1, plan: payment.plan };
      } else if (payment.plan === 'episodes7') {
        user.episodeCredits = (user.episodeCredits || 0) + 7;
        result = { granted: true, type: 'credits', creditsAdded: 7, plan: payment.plan };
      } else if (RECURRING_PLANS.has(payment.plan)) {
        const now = new Date();
        const current = user.subscription;
        const currentExpiry = current?.expiresAt ? new Date(current.expiresAt) : null;
        const renewingSameActivePlan = current?.active
          && current.plan === payment.plan
          && currentExpiry
          && currentExpiry > now;
        const startsAt = renewingSameActivePlan ? currentExpiry : now;
        const expiresAt = new Date(startsAt.getTime() + paymentDurationMs(payment));
        user.subscription = { plan: payment.plan, active: true, expiresAt };
        payment.expiresAt = expiresAt;
        result = { granted: true, type: 'subscription', plan: payment.plan, expiresAt };
      } else {
        throw new Error(`Unsupported paid plan: ${payment.plan}`);
      }

      payment.entitlementGrantedAt = new Date();
      await user.save({ session });
      await payment.save({ session });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { grantCompletedPayment, paymentDurationMs, RECURRING_PLANS };
