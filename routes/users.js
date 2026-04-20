const router = require('express').Router();
const User   = require('../models/User');
const Movie  = require('../models/Movie');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const { publicContact, sanitizeEmail } = require('../utils/authContact');

function serializeUser(user) {
  const payload = user?.toObject ? user.toObject() : { ...user };
  payload.email = sanitizeEmail(payload.email);
  payload.phone = payload.phone || null;
  payload.contact = publicContact(payload);
  return payload;
}

function serializeAdminDevice(user, device) {
  const payload = device?.toObject ? device.toObject() : { ...device };
  const location = payload.location || {};

  return {
    userId: user._id,
    userName: user.name,
    role: user.role,
    status: user.status,
    contact: publicContact(user),
    email: sanitizeEmail(user.email),
    phone: user.phone || null,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName || 'Unknown Device',
    lastSeen: payload.lastSeen || null,
    lastIp: payload.lastIp || null,
    platform: payload.platform || null,
    language: payload.language || null,
    userAgent: payload.userAgent || null,
    location: {
      label: location.label || 'Location unavailable',
      city: location.city || null,
      region: location.region || null,
      country: location.country || null,
      latitude: Number.isFinite(location.latitude) ? location.latitude : null,
      longitude: Number.isFinite(location.longitude) ? location.longitude : null,
      accuracy: Number.isFinite(location.accuracy) ? location.accuracy : null,
      timezone: location.timezone || null,
      source: location.source || 'unknown',
      capturedAt: location.capturedAt || null,
    },
  };
}

// ── GET all users (with filters) ─────────────────────────────────────────────
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { role, status, search, page = 1 } = req.query;
    const query = {};
    if (role)   query.role   = role;
    if (status) query.status = status;
    if (search) query.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password -devices -sessions -resetToken -resetTokenExpiry')
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20).limit(20);
    res.json({ users: users.map(serializeUser), total, pages: Math.ceil(total / 20) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── GET single user ───────────────────────────────────────────────────────────
router.get('/devices/activity', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find({ 'devices.0': { $exists: true } })
      .select('name email phone role status devices');

    const devices = users
      .flatMap((user) => user.devices.map((device) => serializeAdminDevice(user, device)))
      .sort((left, right) => {
        const leftSeen = left.lastSeen ? new Date(left.lastSeen).getTime() : 0;
        const rightSeen = right.lastSeen ? new Date(right.lastSeen).getTime() : 0;
        return rightSeen - leftSeen;
      });

    const activeSince = Date.now() - (24 * 60 * 60 * 1000);
    const recentDevices = devices.filter((device) => {
      if (!device.lastSeen) return false;
      return new Date(device.lastSeen).getTime() >= activeSince;
    }).length;

    res.json({
      devices,
      stats: {
        totalDevices: devices.length,
        totalUsers: new Set(devices.map((device) => String(device.userId))).size,
        recentDevices,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id', protect, adminOnly, async (req, res) => {
  try {
    const user   = await User.findById(req.params.id).select('-password -devices -sessions');
    if (!user) return res.status(404).json({ message: 'User not found' });
    const movies = await Movie.find({ authorId: req.params.id }).select('title views poster createdAt').limit(10);
    res.json({ user: serializeUser(user), movies });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH suspend / activate ──────────────────────────────────────────────────
router.patch('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!['active', 'suspended'].includes(status))
      return res.status(400).json({ message: 'Invalid status' });

    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Notify user
    await Notification.create({
      userId:  req.params.id,
      type:    'system',
      title:   status === 'suspended' ? '⚠ Account suspended' : '✓ Account reactivated',
      message: status === 'suspended'
        ? `Your account has been suspended. ${reason || 'Contact support for more info.'}`
        : 'Your account has been reactivated. Welcome back!',
      link: '/account'
    });

    res.json({ message: `User ${status}`, user });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PATCH change role ─────────────────────────────────────────────────────────
router.patch('/:id/role', protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;
    const allowed = ['viewer', 'author', 'actor'];
    if (!allowed.includes(role)) return res.status(400).json({ message: 'Invalid role' });

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    await Notification.create({
      userId:  req.params.id,
      type:    'system',
      title:   'Account role updated',
      message: `Your account role has been changed to ${role}.`,
      link:    '/account'
    });

    res.json({ message: `Role changed to ${role}`, user });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST send notification to user ───────────────────────────────────────────
router.post('/:id/notify', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, link } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required' });

    await Notification.create({
      userId: req.params.id,
      type:   'system',
      title, message, link: link || '/account'
    });

    res.json({ message: 'Notification sent' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── POST broadcast notification to all / by role ─────────────────────────────
router.post('/broadcast', protect, adminOnly, async (req, res) => {
  try {
    const { title, message, link, role } = req.body;
    if (!title) return res.status(400).json({ message: 'Title required' });

    const query = role ? { role } : {};
    const users = await User.find(query).select('_id');

    await Notification.insertMany(users.map(u => ({
      userId: u._id, type: 'system', title, message, link: link || '/'
    })));

    res.json({ message: `Notification sent to ${users.length} users` });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── DELETE user ───────────────────────────────────────────────────────────────
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'Not found' });
    if (user.role === 'admin') return res.status(403).json({ message: 'Cannot delete admin' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
