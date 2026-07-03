const router = require('express').Router();
const User = require('../models/User');
const Movie = require('../models/Movie');
const Actor = require('../models/Actor');
const Notification = require('../models/Notification');
const { protect, adminOnly } = require('../middleware/auth');
const { deleteStoredAsset } = require('../utils/storage');

async function safeDeleteAsset(reference, options = {}) {
    if (!reference) return;
    try {
        await deleteStoredAsset(reference, options);
    } catch (error) {
        console.warn(`Failed to delete media asset ${reference}: ${error.message}`);
    }
}

// ── BULK DELETE USERS ─────────────────────────────────────────────────────────
router.post('/users/delete', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        // Don't allow deleting admins
        const users = await User.find({ _id: { $in: ids } });
        const adminIds = users.filter(u => u.role === 'admin').map(u => String(u._id));
        const deletableIds = ids.filter(id => !adminIds.includes(id));

        if (deletableIds.length === 0) {
            return res.status(403).json({ message: 'Cannot delete admin users' });
        }

        const result = await User.deleteMany({ _id: { $in: deletableIds } });

        res.json({
            message: `${result.deletedCount} user(s) deleted`,
            deleted: result.deletedCount,
            skipped: adminIds.length,
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK SUSPEND USERS ────────────────────────────────────────────────────────
router.post('/users/suspend', protect, adminOnly, async (req, res) => {
    try {
        const { ids, reason } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const result = await User.updateMany(
            { _id: { $in: ids }, role: { $ne: 'admin' } },
            { $set: { status: 'suspended' } }
        );

        // Send notifications
        const notifications = ids.map(userId => ({
            userId,
            type: 'system',
            title: '⚠ Account suspended',
            message: reason || 'Your account has been suspended. Contact support for more info.',
            link: '/account',
        }));
        await Notification.insertMany(notifications);

        res.json({ message: `${result.modifiedCount} user(s) suspended`, modified: result.modifiedCount });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK ACTIVATE USERS ───────────────────────────────────────────────────────
router.post('/users/activate', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const result = await User.updateMany(
            { _id: { $in: ids } },
            { $set: { status: 'active' } }
        );

        const notifications = ids.map(userId => ({
            userId,
            type: 'system',
            title: '✓ Account reactivated',
            message: 'Your account has been reactivated. Welcome back!',
            link: '/account',
        }));
        await Notification.insertMany(notifications);

        res.json({ message: `${result.modifiedCount} user(s) activated`, modified: result.modifiedCount });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK ASSIGN SUBSCRIPTION ──────────────────────────────────────────────────
router.post('/users/subscription', protect, adminOnly, async (req, res) => {
    try {
        const { ids, plan, durationDays } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const validPlans = ['free', 'basic', 'standard', 'premium', 'weekly'];
        if (!plan || !validPlans.includes(plan)) {
            return res.status(400).json({ message: 'Invalid plan. Must be: free, basic, standard, premium, or weekly' });
        }

        let subscription;
        if (plan === 'free') {
            subscription = { plan: 'free', active: false, expiresAt: null };
        } else {
            const days = Number.parseInt(durationDays, 10);
            if (!Number.isFinite(days) || days < 1) {
                return res.status(400).json({ message: 'Duration in days required (minimum 1 day)' });
            }
            subscription = {
                plan,
                active: true,
                expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
            };
        }

        const result = await User.updateMany(
            { _id: { $in: ids } },
            { $set: { subscription } }
        );

        const notifications = ids.map(userId => ({
            userId,
            type: 'system',
            title: `${plan.charAt(0).toUpperCase() + plan.slice(1)} plan assigned`,
            message: plan === 'free'
                ? 'Your subscription has been reset to free.'
                : `Your ${plan} subscription is now active for ${durationDays} days.`,
            link: '/plans',
        }));
        await Notification.insertMany(notifications);

        res.json({
            message: `${plan} subscription assigned to ${result.modifiedCount} user(s)`,
            modified: result.modifiedCount,
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK NOTIFY USERS ─────────────────────────────────────────────────────────
router.post('/users/notify', protect, adminOnly, async (req, res) => {
    try {
        const { ids, title, message, link } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }
        if (!title) {
            return res.status(400).json({ message: 'Title required' });
        }

        const notifications = ids.map(userId => ({
            userId,
            type: 'system',
            title,
            message: message || '',
            link: link || '/account',
        }));
        await Notification.insertMany(notifications);

        res.json({ message: `Notification sent to ${ids.length} user(s)`, sent: ids.length });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK DELETE MOVIES ────────────────────────────────────────────────────────
router.post('/movies/delete', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const movies = await Movie.find({ _id: { $in: ids } });

        // Collect all media assets to delete
        const staleAssets = movies.flatMap(movie => [
            movie.poster ? { ref: movie.poster, resourceType: 'image' } : null,
            movie.videoUrl ? { ref: movie.videoUrl, resourceType: 'video' } : null,
            ...(movie.episodes || [])
                .filter(ep => ep.videoUrl)
                .map(ep => ({ ref: ep.videoUrl, resourceType: 'video' })),
        ].filter(Boolean));

        const result = await Movie.deleteMany({ _id: { $in: ids } });

        // Clean up media assets in background
        Promise.all(staleAssets.map(asset => safeDeleteAsset(asset.ref, asset))).catch(() => { });

        res.json({ message: `${result.deletedCount} movie(s) deleted`, deleted: result.deletedCount });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK FEATURE/UNFEATURE MOVIES ─────────────────────────────────────────────
router.post('/movies/feature', protect, adminOnly, async (req, res) => {
    try {
        const { ids, featured } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const result = await Movie.updateMany(
            { _id: { $in: ids } },
            { $set: { featured: Boolean(featured) } }
        );

        res.json({
            message: `${result.modifiedCount} movie(s) ${featured ? 'featured' : 'unfeatured'}`,
            modified: result.modifiedCount,
        });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── BULK DELETE ACTORS ────────────────────────────────────────────────────────
router.post('/actors/delete', protect, adminOnly, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: 'ids array required' });
        }

        const actors = await Actor.find({ _id: { $in: ids } });
        const staleAssets = actors
            .filter(a => a.photo)
            .map(a => ({ ref: a.photo, resourceType: 'image' }));

        const result = await Actor.deleteMany({ _id: { $in: ids } });

        // Clean up photos in background
        Promise.all(staleAssets.map(asset => safeDeleteAsset(asset.ref, asset))).catch(() => { });

        res.json({ message: `${result.deletedCount} actor(s) deleted`, deleted: result.deletedCount });
    } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
