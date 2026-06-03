const router = require('express').Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const COMPLETION_THRESHOLD = 0.92; // 92% watched = mark as completed
const MAX_PROGRESS_ENTRIES = 50;   // keep last 50 movies in history

// ── POST save/update watch progress ──────────────────────────────────────────
// Called periodically while watching (every 10-15 seconds)
router.post('/', protect, async (req, res) => {
    try {
        const { movieId, episodeId = null, position, duration } = req.body;

        if (!movieId || position === undefined) {
            return res.status(400).json({ message: 'movieId and position are required' });
        }

        const pos = Math.max(0, Number(position) || 0);
        const dur = Math.max(0, Number(duration) || 0);
        const completed = dur > 0 && pos / dur >= COMPLETION_THRESHOLD;

        const user = await User.findById(req.user.id).select('watchProgress');
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Find existing entry for this movie+episode
        const existing = user.watchProgress.find(p =>
            String(p.movieId) === String(movieId) &&
            (p.episodeId || null) === (episodeId || null)
        );

        if (existing) {
            existing.position = pos;
            existing.duration = dur || existing.duration;
            existing.completed = completed;
            existing.updatedAt = new Date();
        } else {
            // Add new entry, keep list under MAX_PROGRESS_ENTRIES
            if (user.watchProgress.length >= MAX_PROGRESS_ENTRIES) {
                // Remove oldest entry
                user.watchProgress.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
                user.watchProgress.shift();
            }
            user.watchProgress.push({
                movieId,
                episodeId: episodeId || null,
                position: pos,
                duration: dur,
                completed,
                updatedAt: new Date(),
            });
        }

        user.markModified('watchProgress');
        await user.save();

        return res.json({ saved: true, completed });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// ── GET continue watching list ────────────────────────────────────────────────
// Returns movies/episodes the user has started but not finished
router.get('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('watchProgress')
            .populate({
                path: 'watchProgress.movieId',
                select: 'title poster type episodes duration genre year',
            });

        if (!user) return res.status(404).json({ message: 'User not found' });

        // Filter out completed, sort by most recently watched
        const continueWatching = user.watchProgress
            .filter(p => !p.completed && p.position > 5) // more than 5 seconds in
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .slice(0, 20)
            .map(p => {
                const movie = p.movieId;
                if (!movie) return null;

                let episodeTitle = null;
                if (p.episodeId && movie.episodes) {
                    const ep = movie.episodes.id
                        ? movie.episodes.id(p.episodeId)
                        : movie.episodes.find(e => String(e._id) === String(p.episodeId));
                    episodeTitle = ep?.title || null;
                }

                const percent = p.duration > 0 ? Math.round((p.position / p.duration) * 100) : 0;

                return {
                    movieId: movie._id,
                    title: movie.title,
                    poster: movie.poster,
                    type: movie.type,
                    genre: movie.genre,
                    year: movie.year,
                    episodeId: p.episodeId || null,
                    episodeTitle,
                    position: p.position,
                    duration: p.duration,
                    percent,
                    updatedAt: p.updatedAt,
                };
            })
            .filter(Boolean);

        return res.json(continueWatching);
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// ── GET progress for a specific movie ─────────────────────────────────────────
router.get('/:movieId', protect, async (req, res) => {
    try {
        const { episodeId } = req.query;
        const user = await User.findById(req.user.id).select('watchProgress');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const entry = user.watchProgress.find(p =>
            String(p.movieId) === String(req.params.movieId) &&
            (p.episodeId || null) === (episodeId || null)
        );

        if (!entry) return res.json({ position: 0, duration: 0, percent: 0, completed: false });

        const percent = entry.duration > 0 ? Math.round((entry.position / entry.duration) * 100) : 0;
        return res.json({
            position: entry.position,
            duration: entry.duration,
            percent,
            completed: entry.completed,
            updatedAt: entry.updatedAt,
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

// ── DELETE remove progress for a movie ────────────────────────────────────────
router.delete('/:movieId', protect, async (req, res) => {
    try {
        const { episodeId } = req.query;
        await User.findByIdAndUpdate(req.user.id, {
            $pull: {
                watchProgress: {
                    movieId: req.params.movieId,
                    episodeId: episodeId || null,
                },
            },
        });
        return res.json({ removed: true });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;
