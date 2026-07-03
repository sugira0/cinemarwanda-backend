const assert = require('node:assert/strict');
const { activeSubscription, inspectEntitlement } = require('../utils/entitlements');
const { paymentDurationMs, RECURRING_PLANS } = require('../utils/paymentEntitlements');

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const movieA = '507f1f77bcf86cd799439011';
const movieB = '507f1f77bcf86cd799439012';

for (const plan of ['basic', 'standard', 'premium', 'weekly']) {
  assert(RECURRING_PLANS.has(plan));
  const user = { role: 'viewer', subscription: { plan, active: true, expiresAt: future } };
  assert.equal(activeSubscription(user), true, `${plan} must work before expiry`);
  assert.equal(inspectEntitlement(user, movieA).allowed, true);
}

assert.equal(activeSubscription({ subscription: { plan: 'standard', active: true, expiresAt: past } }), false);
assert.equal(activeSubscription({ subscription: { plan: 'ppv', active: true, expiresAt: future } }), false);
assert.equal(activeSubscription({ subscription: { plan: 'episodes7', active: true, expiresAt: future } }), false);

const purchased = {
  role: 'viewer',
  subscription: { plan: 'free', active: false },
  purchasedContent: [{ movieId: movieA, episodeId: null }],
};
assert.equal(inspectEntitlement(purchased, movieA).allowed, true, 'PPV must unlock its movie');
assert.equal(inspectEntitlement(purchased, movieB).allowed, false, 'PPV must not unlock another movie');
assert.equal(inspectEntitlement({ ...purchased, purchasedContent: [{ movieId: movieA, episodeId: 'ep1' }] }, movieA, 'ep1').allowed, true);
assert.equal(inspectEntitlement({ ...purchased, purchasedContent: [{ movieId: movieA, episodeId: 'ep1' }] }, movieA, 'ep2').allowed, false);

const thirtyDays = 30 * 24 * 60 * 60 * 1000;
assert.equal(paymentDurationMs({ plan: 'basic', createdAt: new Date(0), expiresAt: new Date(thirtyDays) }), thirtyDays);
assert.equal(paymentDurationMs({ plan: 'weekly' }), 7 * 24 * 60 * 60 * 1000);

console.log('Entitlement rules verified for subscriptions, expiry, PPV, episodes, and plan durations.');
