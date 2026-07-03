const crypto = require('crypto');
const router = require('express').Router();
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const User = require('../models/User');
const { adminOnly, protect } = require('../middleware/auth');
const { normalizePhone, publicContact } = require('../utils/authContact');
const mtnMomo = require('../utils/mtnMomo');
const { grantCompletedPayment } = require('../utils/paymentEntitlements');

const PAYMENT_METHODS = new Set(['momo', 'airtel', 'card']);

async function getPlan(planId) {
  const plan = await SubscriptionPlan.findOne({ id: planId, active: true });
  return plan || null;
}

router.get('/my', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('subscription episodeCredits purchasedContent');
    const payments = await Payment.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10);
    const subscription = user?.subscription?.toObject?.() || user?.subscription;
    if (subscription?.active && (!subscription.expiresAt || new Date(subscription.expiresAt) <= new Date())) {
      subscription.active = false;
      await User.updateOne({ _id: req.user.id }, { $set: { 'subscription.active': false } });
    }
    return res.json({
      subscription,
      episodeCredits: user?.episodeCredits || 0,
      purchasedTitles: user?.purchasedContent?.length || 0,
      payments,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/initiate', protect, async (req, res) => {
  try {
    const { plan: planId, method, phone, cardLast4, cardName } = req.body;
    const plan = await getPlan(planId);
    if (!plan) {
      return res.status(400).json({ message: 'Invalid or unavailable plan.' });
    }

    if (!PAYMENT_METHODS.has(method)) {
      return res.status(400).json({ message: 'Unsupported payment method' });
    }

    const user = await User.findById(req.user.id);
    const isCardPayment = method === 'card';
    const submittedPhone = normalizePhone(phone);
    const paymentPhone = submittedPhone || normalizePhone(user?.phone);

    if (!isCardPayment && !paymentPhone) {
      return res.status(400).json({ message: 'Enter a valid Rwanda mobile number to pay with.' });
    }

    const reference = `CR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);

    const payment = await Payment.create({
      userId: req.user.id,
      userName: user.name,
      userEmail: publicContact(user),
      plan: plan.id,
      method,
      amount: plan.price,
      reference,
      expiresAt,
      status: 'pending',
      notes: isCardPayment
        ? `Card: ${cardName || user.name || 'Cardholder'}${cardLast4 ? ` ending ${String(cardLast4).slice(-4)}` : ''}`
        : `Phone: ${paymentPhone}`,
    });

    // ── MTN MoMo real API ─────────────────────────────────────────────────────
    let mtnExternalId = null;
    let momoRequested = false;
    let momoError = null;

    if (method === 'momo' && paymentPhone && mtnMomo.isConfigured()) {
      try {
        mtnExternalId = await mtnMomo.requestToPay({
          phone: paymentPhone,
          amount: plan.price,
          reference,
          description: `${plan.name} - Lumina Cinema`,
        });
        payment.notes = `MTN ExternalId: ${mtnExternalId} | Phone: ${paymentPhone}`;
        await payment.save();
        momoRequested = true;
      } catch (momoErr) {
        momoError = momoErr.message;
        console.error('MTN MoMo request failed:', momoErr.message);
        // Update notes with error
        payment.notes = `MTN Error: ${momoErr.message} | Phone: ${paymentPhone}`;
        await payment.save();
      }
    }

    await Notification.create({
      userId: await getAdminId(),
      type: 'system',
      title: `New payment - ${user.name}`,
      message: `${user.name} initiated the ${plan.name} plan via ${method}. Ref: ${reference}${momoError ? ` | MTN Error: ${momoError}` : ''}`,
      link: '/analytics',
    });

    return res.status(201).json({
      payment,
      ussd: null,   // USSD disabled — using MTN API only
      reference,
      momoRequested,
      momoError: momoError || null,
      mtnExternalId,
      message: momoRequested
        ? 'A payment prompt has been sent to your phone. Approve it to activate your plan.'
        : momoError
          ? `MTN payment request failed: ${momoError}. Please try again.`
          : 'Payment initiated.',
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

function buildUSSD(method, amount, reference, phone) {
  if (method === 'momo') return `*182*8*1*${phone}*${amount}*${reference}#`;
  if (method === 'airtel') return `*185*1*1*${phone}*${amount}*${reference}#`;
  return null;
}

async function getAdminId() {
  const admin = await User.findOne({ role: 'admin' }).select('_id');
  return admin?._id;
}

// ── GET check MTN payment status (poll) ───────────────────────────────────────
router.get('/mtn/status/:paymentId', protect, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) return res.status(404).json({ message: 'Payment not found' });
    if (String(payment.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Not your payment' });
    }
    if (payment.status !== 'pending') {
      if (payment.status === 'completed' && !payment.entitlementGrantedAt) {
        await grantCompletedPayment(payment._id);
      }
      return res.json({ status: payment.status, payment });
    }

    // Extract MTN external ID from notes
    const match = payment.notes?.match(/MTN ExternalId: ([a-f0-9-]+)/i);
    if (!match) {
      return res.json({ status: 'pending', payment, note: 'No MTN external ID found' });
    }

    const mtnExternalId = match[1];
    const { status: mtnStatus, reason } = await mtnMomo.checkPaymentStatus(mtnExternalId);

    if (mtnStatus === 'SUCCESSFUL') {
      // Auto-confirm the payment
      payment.status = 'completed';
      await payment.save();

      await grantCompletedPayment(payment._id);
      return res.json({ status: 'completed', payment });
    }

    if (mtnStatus === 'FAILED') {
      payment.status = 'failed';
      payment.notes = `${payment.notes || ''} | FAILED: ${reason || 'unknown'}`;
      await payment.save();
      return res.json({ status: 'failed', reason, payment });
    }

    return res.json({ status: 'pending', mtnStatus, payment });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── POST MTN callback (webhook) ───────────────────────────────────────────────
router.post('/mtn/callback', async (req, res) => {
  try {
    const { externalId, status, reason } = req.body;
    if (!externalId) return res.status(400).json({ message: 'Missing externalId' });

    // Find payment by MTN external ID stored in notes
    const payment = await Payment.findOne({
      notes: { $regex: externalId, $options: 'i' },
    });

    if (!payment) {
      return res.status(200).json({ message: 'Payment not found' });
    }
    if (payment.status === 'completed') {
      if (!payment.entitlementGrantedAt) await grantCompletedPayment(payment._id);
      return res.status(200).json({ received: true, alreadyCompleted: true });
    }

    if (status === 'SUCCESSFUL') {
      payment.status = 'completed';
      await payment.save();

      await grantCompletedPayment(payment._id);
    } else if (status === 'FAILED') {
      payment.status = 'failed';
      payment.notes = `${payment.notes || ''} | FAILED: ${reason || 'unknown'}`;
      await payment.save();
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('MTN callback error:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

router.post('/:id/confirm', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (payment.status === 'completed') {
      const entitlement = await grantCompletedPayment(payment._id);
      return res.json({ message: 'Already completed', payment, entitlement });
    }

    payment.status = 'completed';
    await payment.save();

    const entitlement = await grantCompletedPayment(payment._id);
    await Notification.create({
      userId: payment.userId,
      type: 'system',
      title: entitlement.type === 'subscription' ? 'Subscription activated' : 'Paid access activated',
      message: entitlement.type === 'subscription'
        ? `Your ${payment.plan} plan is active until ${new Date(entitlement.expiresAt).toLocaleDateString()}.`
        : 'Your payment is confirmed and your purchased access is ready.',
      link: payment.movieId ? `/movies/${payment.movieId}` : '/movies',
    });

    return res.json({ message: 'Confirmed', payment });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/:id/reject', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Not found' });
    }

    payment.status = req.body.refund ? 'refunded' : 'failed';
    payment.notes = req.body.reason || payment.notes || '';
    await payment.save();

    await Notification.create({
      userId: payment.userId,
      type: 'system',
      title: 'Payment update',
      message: `Your payment of ${payment.amount} RWF was ${payment.status}. ${payment.notes}`.trim(),
      link: '/account',
    });

    return res.json({ message: `Marked as ${payment.status}` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { status, search, startDate, endDate, page = 1 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { userName: { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
        { plan: { $regex: search, $options: 'i' } },
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20);

    // Attach phone from User for each payment
    const userIds = [...new Set(payments.map(p => String(p.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select('_id phone');
    const phoneMap = {};
    users.forEach(u => { phoneMap[String(u._id)] = u.phone || null; });

    const enriched = payments.map(p => ({
      ...p.toObject(),
      userPhone: phoneMap[String(p.userId)] || null,
    }));

    // Per-plan revenue stats
    const allPayments = await Payment.find({ status: 'completed' }).select('plan amount');
    const planStats = {};
    allPayments.forEach(p => {
      if (!planStats[p.plan]) planStats[p.plan] = { revenue: 0, count: 0 };
      planStats[p.plan].revenue += p.amount;
      planStats[p.plan].count += 1;
    });

    return res.json({ payments: enriched, total, pages: Math.ceil(total / 20), planStats });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── POST initiate PPV (pay per movie/episode) ─────────────────────────────────
router.post('/ppv', protect, async (req, res) => {
  try {
    const { movieId, episodeId, method, phone } = req.body;
    if (!movieId) return res.status(400).json({ message: 'movieId is required.' });

    const PPV_PRICE = 100; // RWF per movie or episode
    const user = await User.findById(req.user.id);

    // Check if already purchased
    const alreadyBought = user.purchasedContent?.some(p =>
      String(p.movieId) === String(movieId) &&
      (episodeId ? p.episodeId === episodeId : !p.episodeId)
    );
    if (alreadyBought) {
      return res.status(400).json({ message: 'You have already purchased this content.' });
    }

    if (!PAYMENT_METHODS.has(method)) {
      return res.status(400).json({ message: 'Unsupported payment method.' });
    }

    const submittedPhone = normalizePhone(phone);
    const paymentPhone = user?.phone || submittedPhone;
    if (method !== 'card' && !paymentPhone) {
      return res.status(400).json({ message: 'Add a valid Rwanda mobile number to your account first.' });
    }
    if (method !== 'card' && !user.phone && submittedPhone) {
      user.phone = submittedPhone;
      await user.save();
    }

    const reference = `CR-PPV-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const payment = await Payment.create({
      userId: req.user.id,
      userName: user.name,
      userEmail: publicContact(user),
      plan: 'ppv',
      amount: PPV_PRICE,
      method,
      reference,
      movieId,
      episodeId: episodeId || null,
      status: 'pending',
      notes: `PPV: ${episodeId ? 'episode' : 'movie'} ${movieId}`,
    });

    const ussd = buildUSSD(method, PPV_PRICE, reference, paymentPhone);
    return res.status(201).json({ payment, ussd, reference });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ── GET check PPV access ──────────────────────────────────────────────────────
router.get('/ppv/check/:movieId', protect, async (req, res) => {
  try {
    const { episodeId } = req.query;
    const user = await User.findById(req.user.id).select('purchasedContent');
    const hasPurchased = user?.purchasedContent?.some(p =>
      String(p.movieId) === String(req.params.movieId) &&
      (episodeId ? p.episodeId === episodeId : !p.episodeId)
    );
    res.json({ purchased: Boolean(hasPurchased) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
