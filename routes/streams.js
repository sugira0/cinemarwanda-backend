const fs = require('fs');
const router = require('express').Router();
const Movie = require('../models/Movie');
const Stream = require('../models/Stream');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { requireSubscription } = require('../middleware/subscription');
const { getUploadPath, isRemoteMediaPath } = require('../utils/media');

const PLAN_LIMITS = { free: 0, basic: 1, standard: 2, premium: 4 };
const ACTIVE_STREAM_WINDOW_MS = 60000;

function hasVideoSource(entry) {
  return Boolean(entry?.videoUrl || entry?.videoLink);
}

function buildPlaybackSource(movieId, source, deviceId, token = null, episodeId = null) {
  if (source.videoUrl) {
    const basePath = episodeId
      ? `/api/streams/media/movies/${movieId}/episodes/${episodeId}`
      : `/api/streams/media/movies/${movieId}`;
    const params = new URLSearchParams({ deviceId });

    if (token) {
      params.set('token', token);
    }

    return {
      allowed: true,
      kind: 'file',
      source: `${basePath}?${params.toString()}`,
    };
  }

  return {
    allowed: true,
    kind: 'external',
    source: source.videoLink,
  };
}

function getPlaybackEntry(movie, episodeId = null) {
  if (!movie) return null;
  return episodeId ? movie.episodes.id(episodeId) : movie;
}

router.post('/start', protect, async (req, res) => {
  try {
    const { movieId, deviceId, episodeId } = req.body;
    if (!movieId || !deviceId) {
      return res.status(400).json({ message: 'movieId and deviceId are required' });
    }

    const token = req.headers.authorization?.split(' ')[1] || null;
    const [user, movie] = await Promise.all([
      User.findById(req.user.id).select('subscription role'),
      Movie.findById(movieId).select('videoUrl videoLink episodes'),
    ]);

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const playbackEntry = getPlaybackEntry(movie, episodeId);
    if (!playbackEntry || !hasVideoSource(playbackEntry)) {
      return res.status(404).json({ message: 'Video not found' });
    }

    const playback = buildPlaybackSource(movie._id, playbackEntry, deviceId, token, episodeId);

    if (user.role === 'admin' || user.role === 'author') {
      await Stream.findOneAndUpdate(
        { userId: req.user.id, deviceId },
        { userId: req.user.id, movieId, deviceId, lastPing: new Date() },
        { upsert: true, new: true },
      );
      return res.json(playback);
    }

    const plan = user.subscription?.plan || 'free';
    const limit = PLAN_LIMITS[plan] || 0;

    if (limit === 0) {
      return res.status(403).json({
        allowed: false,
        code: 'NO_SUBSCRIPTION',
        message: 'Subscription required to watch.',
      });
    }

    const activeStreams = await Stream.find({
      userId: req.user.id,
      deviceId: { $ne: deviceId },
      lastPing: { $gt: new Date(Date.now() - ACTIVE_STREAM_WINDOW_MS) },
    });

    if (activeStreams.length >= limit) {
      return res.status(403).json({
        allowed: false,
        code: 'STREAM_LIMIT',
        message: `Your ${plan} plan allows ${limit} concurrent stream${limit > 1 ? 's' : ''}. Stop watching on another device first.`,
        limit,
        active: activeStreams.length,
      });
    }

    await Stream.findOneAndUpdate(
      { userId: req.user.id, deviceId },
      { userId: req.user.id, movieId, deviceId, lastPing: new Date() },
      { upsert: true, new: true },
    );

    return res.json({
      ...playback,
      limit,
      active: activeStreams.length + 1,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/ping', protect, async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }

    await Stream.findOneAndUpdate(
      { userId: req.user.id, deviceId },
      { lastPing: new Date() },
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/stop', protect, async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }

    await Stream.findOneAndDelete({ userId: req.user.id, deviceId });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/media/movies/:movieId', protect, requireSubscription, async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }

    const activeStream = await Stream.findOne({
      userId: req.user.id,
      deviceId,
      movieId: req.params.movieId,
      lastPing: { $gt: new Date(Date.now() - ACTIVE_STREAM_WINDOW_MS) },
    });

    if (!activeStream) {
      return res.status(403).json({ message: 'Stream session expired. Reopen the player to continue.' });
    }

    const movie = await Movie.findById(req.params.movieId).select('videoUrl');
    if (!movie?.videoUrl) {
      return res.status(404).json({ message: 'Video not found' });
    }

    if (isRemoteMediaPath(movie.videoUrl)) {
      return res.redirect(movie.videoUrl);
    }

    const filePath = getUploadPath(movie.videoUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Video file not found' });
    }

    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/media/movies/:movieId/episodes/:episodeId', protect, requireSubscription, async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ message: 'deviceId is required' });
    }

    const activeStream = await Stream.findOne({
      userId: req.user.id,
      deviceId,
      movieId: req.params.movieId,
      lastPing: { $gt: new Date(Date.now() - ACTIVE_STREAM_WINDOW_MS) },
    });

    if (!activeStream) {
      return res.status(403).json({ message: 'Stream session expired. Reopen the player to continue.' });
    }

    const movie = await Movie.findById(req.params.movieId).select('episodes');
    const episode = movie?.episodes.id(req.params.episodeId);
    if (!episode?.videoUrl) {
      return res.status(404).json({ message: 'Episode video not found' });
    }

    if (isRemoteMediaPath(episode.videoUrl)) {
      return res.redirect(episode.videoUrl);
    }

    const filePath = getUploadPath(episode.videoUrl);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Video file not found' });
    }

    return res.sendFile(filePath);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
