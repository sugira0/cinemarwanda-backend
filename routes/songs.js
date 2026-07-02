const router = require('express').Router();
const Song = require('../models/Song');
const { protect, authorOrAdmin } = require('../middleware/auth');
const { uploadAsset, deleteStoredAsset, upload } = require('../utils/storage');
const { broadcastPush } = require('../utils/pushNotification');

const SUMMARY_FIELDS = 'title artist album genre year language country cover audioLink duration featured plays authorId createdAt updatedAt';

function serializeSong(song, user) {
    const s = song?.toObject ? song.toObject() : { ...song };
    const isOwner = user?.role === 'admin' || String(user?.id) === String(s.authorId);

    // Free users: remove full audio src — frontend handles 30s preview via HTML5
    const hasAudio = Boolean(s.audioUrl || s.audioLink);

    if (!isOwner) {
        // Keep audioLink for streaming; audioUrl (private Cloudinary) only for owners
        delete s.audioUrl;
    }

    return { ...s, hasAudio };
}

// ── GET /api/songs — browse all ───────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { search, genre, featured, limit = 60, skip = 0 } = req.query;
        const query = {};
        if (search) query.$text = { $search: search };
        if (genre) query.genre = genre;
        if (featured === 'true') query.featured = true;

        const songs = await Song.find(query)
            .sort({ createdAt: -1 })
            .skip(Number(skip))
            .limit(Math.min(Number(limit), 60))
            .select(SUMMARY_FIELDS)
            .lean();

        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(songs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── GET /api/songs/featured — homepage featured ───────────────────────────────
router.get('/featured', async (req, res) => {
    try {
        const songs = await Song.find({ featured: true })
            .sort({ createdAt: -1 })
            .limit(10)
            .select(SUMMARY_FIELDS)
            .lean();
        res.json(songs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── GET /api/songs/my — author's own songs ────────────────────────────────────
router.get('/my', protect, authorOrAdmin, async (req, res) => {
    try {
        const songs = await Song.find({ authorId: req.user.id })
            .sort({ createdAt: -1 })
            .lean();
        res.json(songs.map(s => serializeSong(s, req.user)));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── GET /api/songs/:id ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const song = await Song.findById(req.params.id).lean();
        if (!song) return res.status(404).json({ message: 'Song not found.' });

        // Increment play count
        await Song.findByIdAndUpdate(req.params.id, { $inc: { plays: 1 } });

        res.json(serializeSong(song, null));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ── POST /api/songs — upload new song ─────────────────────────────────────────
router.post('/', protect, authorOrAdmin, upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
]), async (req, res) => {
    const uploadedAssets = [];
    try {
        const { title, artist, album, genre, year, language, country, audioLink, duration, featured } = req.body;

        if (!title?.trim()) return res.status(400).json({ message: 'Title is required.' });
        if (!artist?.trim()) return res.status(400).json({ message: 'Artist name is required.' });

        const coverAsset = req.files?.cover?.[0]
            ? await uploadAsset(req.files.cover[0], { folder: 'song-covers', resourceType: 'image' })
            : null;
        uploadedAssets.push(coverAsset);

        const audioAsset = req.files?.audio?.[0]
            ? await uploadAsset(req.files.audio[0], { folder: 'songs', resourceType: 'video' }) // Cloudinary uses 'video' for audio
            : null;
        uploadedAssets.push(audioAsset);

        const song = await Song.create({
            title: title.trim(),
            artist: artist.trim(),
            album: album?.trim() || '',
            genre: genre ? genre.split(',').map(g => g.trim()).filter(Boolean) : [],
            year: Number(year) || undefined,
            language: language || 'Kinyarwanda',
            country: country || 'Rwanda',
            cover: coverAsset?.ref || null,
            audioUrl: audioAsset?.ref || null,
            audioLink: audioLink || null,
            duration: Number(duration) || 0,
            featured: req.user.role === 'admin' && featured === 'true',
            authorId: req.user.id,
        });

        broadcastPush({
            title: `🎵 New Song: ${song.title}`,
            body: `${song.artist} just dropped a new track on Lumina Cinema!`,
            type: 'new_song',
            link: `/music/${song._id}`,
            data: { songId: String(song._id) },
        }).catch(() => { });

        res.status(201).json(song);
    } catch (err) {
        // Clean up any uploaded assets on error
        for (const asset of uploadedAssets) {
            if (asset?.ref) deleteStoredAsset(asset.ref, asset.resourceType || 'image').catch(() => { });
        }
        res.status(err.statusCode || 500).json({ message: err.message });
    }
});

// ── PUT /api/songs/:id — update song ─────────────────────────────────────────
router.put('/:id', protect, authorOrAdmin, upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
]), async (req, res) => {
    const uploadedAssets = [];
    const staleAssets = [];
    try {
        const song = await Song.findById(req.params.id);
        if (!song) return res.status(404).json({ message: 'Song not found.' });

        const isOwner = req.user.role === 'admin' || String(req.user.id) === String(song.authorId);
        if (!isOwner) return res.status(403).json({ message: 'Not authorized.' });

        const { title, artist, album, genre, year, language, country, audioLink, duration, featured } = req.body;

        if (title) song.title = title.trim();
        if (artist) song.artist = artist.trim();
        if (album !== undefined) song.album = album.trim();
        if (genre) song.genre = genre.split(',').map(g => g.trim()).filter(Boolean);
        if (year) song.year = Number(year);
        if (language) song.language = language;
        if (country) song.country = country;
        if (audioLink !== undefined) song.audioLink = audioLink || null;
        if (duration) song.duration = Number(duration);
        if (req.user.role === 'admin' && featured !== undefined) {
            song.featured = featured === 'true';
        }

        if (req.files?.cover?.[0]) {
            const coverAsset = await uploadAsset(req.files.cover[0], { folder: 'song-covers', resourceType: 'image' });
            uploadedAssets.push(coverAsset);
            if (song.cover) staleAssets.push({ ref: song.cover, resourceType: 'image' });
            song.cover = coverAsset.ref;
        }

        if (req.files?.audio?.[0]) {
            const audioAsset = await uploadAsset(req.files.audio[0], { folder: 'songs', resourceType: 'video' });
            uploadedAssets.push(audioAsset);
            if (song.audioUrl) staleAssets.push({ ref: song.audioUrl, resourceType: 'video' });
            song.audioUrl = audioAsset.ref;
        }

        await song.save();

        // Delete old assets after successful save
        for (const asset of staleAssets) {
            deleteStoredAsset(asset.ref, asset.resourceType).catch(() => { });
        }

        res.json(song);
    } catch (err) {
        for (const asset of uploadedAssets) {
            if (asset?.ref) deleteStoredAsset(asset.ref, asset.resourceType || 'image').catch(() => { });
        }
        res.status(err.statusCode || 500).json({ message: err.message });
    }
});

// ── DELETE /api/songs/:id ─────────────────────────────────────────────────────
router.delete('/:id', protect, authorOrAdmin, async (req, res) => {
    try {
        const song = await Song.findById(req.params.id);
        if (!song) return res.status(404).json({ message: 'Song not found.' });

        const isOwner = req.user.role === 'admin' || String(req.user.id) === String(song.authorId);
        if (!isOwner) return res.status(403).json({ message: 'Not authorized.' });

        if (song.cover) deleteStoredAsset(song.cover, 'image').catch(() => { });
        if (song.audioUrl) deleteStoredAsset(song.audioUrl, 'video').catch(() => { });

        await Song.findByIdAndDelete(req.params.id);
        res.json({ message: 'Song deleted.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
