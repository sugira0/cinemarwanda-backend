const router  = require('express').Router();
const Actor   = require('../models/Actor');
const Movie   = require('../models/Movie');
const { protect, adminOnly, authorOrAdmin } = require('../middleware/auth');
const { deleteStoredAsset, upload, uploadAsset } = require('../utils/storage');

async function safeDeleteAsset(reference, options = {}) {
  if (!reference) return;

  try {
    await deleteStoredAsset(reference, options);
  } catch (error) {
    console.warn(`Failed to delete media asset ${reference}: ${error.message}`);
  }
}

// GET all actors
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const query = search ? { name: { $regex: search, $options: 'i' } } : {};
    const actors = await Actor.find(query).sort({ name: 1 });
    res.json(actors.map(a => ({
      ...a.toObject(),
      followersCount: a.followers.length,
      likesCount:     a.likes.length,
      followers: undefined,
      likes: undefined
    })));  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET single actor + their movies
router.get('/:id', async (req, res) => {
  try {
    const actor  = await Actor.findById(req.params.id);
    if (!actor) return res.status(404).json({ message: 'Actor not found' });
    const movies = await Movie.find({ cast: actor._id }).select('-viewedIPs').sort({ year: -1 });
    res.json({
      ...actor.toObject(),
      followersCount: actor.followers.length,
      likesCount:     actor.likes.length,
      isFollowing:    req.headers.authorization ? actor.followers.map(String).includes(req.user?.id) : false,
      isLiked:        req.headers.authorization ? actor.likes.map(String).includes(req.user?.id)     : false,
      movies
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST create actor (admin/author)
router.post('/', protect, authorOrAdmin, upload.single('photo'), async (req, res) => {
  let photoAsset = null;

  try {
    const { name, bio, birthDate, birthPlace, instagram, tiktok, twitter } = req.body;
    photoAsset = req.file
      ? await uploadAsset(req.file, { folder: 'actors', resourceType: 'image' })
      : null;
    const actor = await Actor.create({
      name, bio, birthDate, birthPlace,
      photo: photoAsset?.ref || null,
      social: { instagram: instagram || '', tiktok: tiktok || '', twitter: twitter || '' }
    });
    res.status(201).json(actor);
  } catch (err) {
    if (photoAsset) {
      await safeDeleteAsset(photoAsset.ref, { resourceType: 'image' });
    }
    res.status(500).json({ message: err.message });
  }
});

// PUT update actor (admin/author/own actor)
router.put('/:id', protect, upload.single('photo'), async (req, res) => {
  let photoAsset = null;
  let staleAsset = null;

  try {
    const actor = await Actor.findById(req.params.id);
    if (!actor) return res.status(404).json({ message: 'Not found' });

    // Allow: admin, author, or the actor themselves
    const isOwner = actor.userId && String(actor.userId) === String(req.user.id);
    const canEdit = req.user.role === 'admin' || req.user.role === 'author' || isOwner;
    if (!canEdit) return res.status(403).json({ message: 'Not allowed' });

    const { name, bio, birthDate, birthPlace, instagram, tiktok, twitter } = req.body;
    if (name)       actor.name       = name;
    if (bio)        actor.bio        = bio;
    if (birthDate)  actor.birthDate  = birthDate;
    if (birthPlace) actor.birthPlace = birthPlace;
    if (req.file) {
      photoAsset = await uploadAsset(req.file, { folder: 'actors', resourceType: 'image' });
      staleAsset = actor.photo ? { ref: actor.photo, resourceType: 'image' } : null;
      actor.photo = photoAsset.ref;
    }
    actor.social = {
      instagram: instagram !== undefined ? instagram : (actor.social?.instagram || ''),
      tiktok:    tiktok    !== undefined ? tiktok    : (actor.social?.tiktok    || ''),
      twitter:   twitter   !== undefined ? twitter   : (actor.social?.twitter   || ''),
    };
    await actor.save();
    if (staleAsset) {
      await safeDeleteAsset(staleAsset.ref, staleAsset);
    }
    res.json(actor);
  } catch (err) {
    if (photoAsset) {
      await safeDeleteAsset(photoAsset.ref, { resourceType: 'image' });
    }
    res.status(500).json({ message: err.message });
  }
});

// DELETE actor (admin only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const actor = await Actor.findByIdAndDelete(req.params.id);
    if (actor?.photo) {
      await safeDeleteAsset(actor.photo, { resourceType: 'image' });
    }
    res.json({ message: 'Actor deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST follow/unfollow
router.post('/:id/follow', protect, async (req, res) => {
  try {
    const actor = await Actor.findById(req.params.id);
    if (!actor) return res.status(404).json({ message: 'Not found' });
    const uid = req.user.id;
    const idx = actor.followers.map(String).indexOf(uid);
    if (idx === -1) actor.followers.push(uid);
    else            actor.followers.splice(idx, 1);
    await actor.save();
    res.json({ following: idx === -1, followersCount: actor.followers.length });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST like/unlike
router.post('/:id/like', protect, async (req, res) => {
  try {
    const actor = await Actor.findById(req.params.id);
    if (!actor) return res.status(404).json({ message: 'Not found' });
    const uid = req.user.id;
    const idx = actor.likes.map(String).indexOf(uid);
    if (idx === -1) actor.likes.push(uid);
    else            actor.likes.splice(idx, 1);
    await actor.save();
    res.json({ liked: idx === -1, likesCount: actor.likes.length });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
