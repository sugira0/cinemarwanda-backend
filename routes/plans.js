const router = require('express').Router();
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Payment = require('../models/Payment');
const { protect, adminOnly } = require('../middleware/auth');

// Seed defaults if no plans exist yet
const SEED_PLANS = [
  { id: 'basic', name: 'Basic', description: 'Full catalog access. 1 concurrent stream.', price: 2000, durationDays: 30, streams: 1, features: ['Full catalog access', '1 concurrent stream', 'MTN MoMo or Airtel Money'], order: 1 },
  { id: 'standard', name: 'Standard', description: 'Full catalog access. 2 concurrent streams.', price: 5000, durationDays: 30, streams: 2, features: ['Full catalog access', '2 concurrent streams', 'MTN MoMo or Airtel Money'], order: 2 },
  { id: 'premium', name: 'Premium', description: 'Full catalog access. 4 concurrent streams.', price: 10000, durationDays: 30, streams: 4, features: ['Full catalog access', '4 concurrent streams', 'MTN MoMo or Airtel Money'], order: 3 },
  { id: 'weekly', name: 'Weekly', description: 'Full catalog access for 7 days.', price: 2000, durationDays: 7, streams: 2, features: ['Full catalog access', '2 concurrent streams', 'MTN MoMo or Airtel Money', 'No monthly commitment'], order: 4 },
  { id: 'episodes7', name: '7 Episodes Pack', description: 'Unlock any 7 episodes or movies for 500 RWF.', price: 500, durationDays: 30, streams: 1, features: ['Unlock 7 episodes or movies', 'Valid for 30 days', 'MTN MoMo or Airtel Money', 'No monthly commitment'], order: 5 },
  { id: 'ppv', name: 'Single Episode', description: 'Pay 100 RWF to unlock one movie or episode permanently.', price: 100, durationDays: 36500, streams: 1, features: ['One movie or episode', 'Permanent access', 'MTN MoMo or Airtel Money'], order: 6 },
];

async function ensureSeedPlans() {
  for (const plan of SEED_PLANS) {
    const exists = await SubscriptionPlan.findOne({ id: plan.id });
    if (!exists) await SubscriptionPlan.create(plan);
  }
}

// ── GET all plans (public — active only) ──────────────────────────────────────
router.get('/public', async (req, res) => {
  try {
    await ensureSeedPlans();
    const plans = await SubscriptionPlan.find({ active: true }).sort({ order: 1, price: 1 });
    res.json(plans);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET all plans (admin — all including inactive) ────────────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    await ensureSeedPlans();
    const plans = await SubscriptionPlan.find().sort({ order: 1, price: 1 });

    // Attach subscriber count per plan
    const counts = await Payment.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$plan', subscribers: { $sum: 1 }, revenue: { $sum: '$amount' } } },
    ]);
    const statsMap = {};
    counts.forEach(c => { statsMap[c._id] = { subscribers: c.subscribers, revenue: c.revenue }; });

    const enriched = plans.map(p => ({
      ...p.toObject(),
      subscribers: statsMap[p.id]?.subscribers || 0,
      revenue: statsMap[p.id]?.revenue || 0,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── POST create plan ──────────────────────────────────────────────────────────
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { id, name, description, price, durationDays, streams, features, active, order } = req.body;

    if (!id || !name || price === undefined || !durationDays) {
      return res.status(400).json({ message: 'id, name, price and durationDays are required.' });
    }

    const exists = await SubscriptionPlan.findOne({ id: id.toLowerCase().trim() });
    if (exists) return res.status(400).json({ message: `Plan with id "${id}" already exists.` });

    const plan = await SubscriptionPlan.create({
      id: id.toLowerCase().trim(),
      name: String(name).trim(),
      description: String(description || '').trim(),
      price: Math.max(0, Number(price)),
      durationDays: Math.max(1, Number(durationDays)),
      streams: Math.max(1, Number(streams || 1)),
      features: Array.isArray(features) ? features.filter(Boolean) : [],
      active: active !== false,
      order: Number(order || 0),
    });

    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PUT update plan ───────────────────────────────────────────────────────────
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findOne({ id: req.params.id });
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });

    const { name, description, price, durationDays, streams, features, active, order } = req.body;

    if (name !== undefined) plan.name = String(name).trim();
    if (description !== undefined) plan.description = String(description).trim();
    if (price !== undefined) plan.price = Math.max(0, Number(price));
    if (durationDays !== undefined) plan.durationDays = Math.max(1, Number(durationDays));
    if (streams !== undefined) plan.streams = Math.max(1, Number(streams));
    if (features !== undefined) plan.features = Array.isArray(features) ? features.filter(Boolean) : [];
    if (active !== undefined) plan.active = Boolean(active);
    if (order !== undefined) plan.order = Number(order);

    await plan.save();
    res.json(plan);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE plan ───────────────────────────────────────────────────────────────
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findOne({ id: req.params.id });
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });

    // Check if any active subscribers exist
    const activeCount = await Payment.countDocuments({ plan: req.params.id, status: 'completed' });
    if (activeCount > 0 && !req.query.force) {
      return res.status(400).json({
        message: `This plan has ${activeCount} completed payment(s). Use ?force=true to delete anyway, or deactivate it instead.`,
        canForce: true,
      });
    }

    await SubscriptionPlan.deleteOne({ id: req.params.id });
    res.json({ message: 'Plan deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH toggle active ───────────────────────────────────────────────────────
router.patch('/:id/toggle', protect, adminOnly, async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findOne({ id: req.params.id });
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });
    plan.active = !plan.active;
    await plan.save();
    res.json({ message: `Plan ${plan.active ? 'activated' : 'deactivated'}.`, active: plan.active });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
