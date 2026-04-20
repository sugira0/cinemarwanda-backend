const crypto = require('crypto');
const router = require('express').Router();
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { adminOnly, protect } = require('../middleware/auth');
const { normalizePhone, publicContact } = require('../utils/authContact');

const PLANS = {
  basic: { price: 2000, days: 30, label: 'Basic' },
  standard: { price: 5000, days: 30, label: 'Standard' },
  premium: { price: 10000, days: 30, label: 'Premium' },
};

const PAYMENT_METHODS = new Set(['momo', 'airtel']);

router.get('/my', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('subscription');
    const payments = await Payment.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(10);
    return res.json({ subscription: user?.subscription, payments });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/initiate', protect, async (req, res) => {
  try {
    const { plan, method, phone } = req.body;
    if (!PLANS[plan]) {
      return res.status(400).json({ message: 'Invalid plan' });
    }

    if (!PAYMENT_METHODS.has(method)) {
      return res.status(400).json({ message: 'Unsupported payment method' });
    }

    const user = await User.findById(req.user.id);
    const submittedPhone = normalizePhone(phone);
    let paymentPhone = user?.phone || submittedPhone;

    if (user?.phone && submittedPhone && submittedPhone !== user.phone) {
      return res.status(400).json({ message: 'Use the mobile number saved on your account for subscription payments' });
    }

    if (!paymentPhone) {
      return res.status(400).json({ message: 'Add a valid Rwanda mobile number to your account first' });
    }

    if (!user.phone) {
      user.phone = paymentPhone;
      await user.save();
    }

    const reference = `CR-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + PLANS[plan].days * 24 * 60 * 60 * 1000);

    const payment = await Payment.create({
      userId: req.user.id,
      userName: user.name,
      userEmail: publicContact(user),
      plan,
      method,
      amount: PLANS[plan].price,
      reference,
      expiresAt,
      status: 'pending',
      notes: `Phone: ${paymentPhone}`,
    });

    const ussd = buildUSSD(method, PLANS[plan].price, reference, paymentPhone);

    await Notification.create({
      userId: await getAdminId(),
      type: 'system',
      title: `New payment - ${user.name}`,
      message: `${user.name} initiated the ${PLANS[plan].label} plan via ${method}. Ref: ${reference}`,
      link: '/analytics',
    });

    return res.status(201).json({ payment, ussd, reference });
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

router.post('/:id/confirm', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (payment.status === 'completed') {
      return res.status(400).json({ message: 'Already completed' });
    }

    payment.status = 'completed';
    await payment.save();

    if (payment.expiresAt) {
      await User.findByIdAndUpdate(payment.userId, {
        subscription: { plan: payment.plan, expiresAt: payment.expiresAt, active: true },
      });
    }

    await Notification.create({
      userId: payment.userId,
      type: 'system',
      title: 'Payment confirmed',
      message: `Your ${payment.plan} plan is now active until ${new Date(payment.expiresAt).toLocaleDateString()}.`,
      link: '/account',
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
    const { status, page = 1 } = req.query;
    const query = status ? { status } : {};
    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20);
    return res.json({ payments, total, pages: Math.ceil(total / 20) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
