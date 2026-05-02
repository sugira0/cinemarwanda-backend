const router = require('express').Router();
const Movie = require('../models/Movie');
const Stream = require('../models/Stream');
const { protect, authorOrAdmin, getRequestToken, resolveAuthToken } = require('../middleware/auth');
const { requireSubscription } = require('../middleware/subscription');
const { uploadAsset, deleteStoredAsset, upload } = require('../utils/storage');

const ACTIVE_STREAM_WINDOW_MS = 60000;

async function optionalAuth(req) {
  try {
    const auth = await resolveAuthToken(getRequestToken(req));
    return auth ? { id: auth.userId, role: auth.role } : null;
  } catch {
    return null;
  }
}

function canSeePrivateFields(movie, user) {
  return user?.role === 'admin' || (user?.role === 'author' && String(user.id) === String(movie.authorId));
}

function hasVideoSource(entry) {
  return Boolean(entry?.videoUrl || entry?.videoLink);
}

function serializeEpisode(episode, includePrivateMedia) {
  const payload = episode?.toObject ? episode.toObject() : { ...episode };
  payload.hasVideo = hasVideoSource(payload);

  if (!includePrivateMedia) {
    delete payload.videoUrl;
    delete payload.videoLink;
  }

  return payload;
}

function serializeMovie(movie, user) {
  const payload = movie?.toObject ? movie.toObject() : { ...movie };
  const includePrivateFields = canSeePrivateFields(payload, user);

  delete payload.viewedIPs;
  payload.hasVideo = hasVideoSource(payload);
  payload.episodes = Array.isArray(payload.episodes)
    ? payload.episodes.map((episode) => serializeEpisode(episode, includePrivateFields))
    : [];

  if (!includePrivateFields) {
    delete payload.videoUrl;
    delete payload.videoLink;
  }

  return payload;
}

function serializeMovieSummary(movie) {
  const payload = movie?.toObject ? movie.toObject() : { ...movie };
  const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];

  return {
    _id: payload._id,
    title: payload.title,
    description: payload.description,
    genre: payload.genre || [],
    year: payload.year,
    duration: payload.duration,
    language: payload.language,
    poster: payload.poster,
    trailerUrl: payload.trailerUrl,
    type: payload.type || 'movie',
    featured: Boolean(payload.featured),
    views: payload.views || 0,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    hasVideo: hasVideoSource(payload) || episodes.some((episode) => hasVideoSource(episode)),
    episodes: episodes.map((episode) => ({
      _id: episode._id,
      season: episode.season,
      episode: episode.episode,
      title: episode.title,
      duration: episode.duration,
      hasVideo: hasVideoSource(episode),
    })),
  };
}

function canEdit(movie, user) {
  return user?.role === 'admin' || String(movie.authorId) === String(user?.id);
}

async function safeDeleteAsset(reference, options = {}) {
  if (!reference) {
    return;
  }

  try {
    await deleteStoredAsset(reference, options);
  } catch (error) {
    console.warn(`Failed to delete media asset ${reference}: ${error.message}`);
  }
}

async function cleanupUploadedAssets(assets) {
  await Promise.all(
    assets
      .filter(Boolean)
      .map((asset) => safeDeleteAsset(asset.ref, { resourceType: asset.resourceType }))
  );
}

async function ensureActiveStream(userId, deviceId, movieId) {
  if (!deviceId) {
    return { ok: false, status: 400, message: 'deviceId is required' };
  }

  const stream = await Stream.findOne({
    userId,
    deviceId,
    movieId,
    lastPing: { $gt: new Date(Date.now() - ACTIVE_STREAM_WINDOW_MS) },
  });

  if (!stream) {
    return { ok: false, status: 403, message: 'Stream session expired. Reopen the player to continue.' };
  }

  return { ok: true };
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

router.get('/', async (req, res) => {
  try {
    const { search, genre, type } = req.query;
    const query = {};

    if (search) query.title = { $regex: search, $options: 'i' };
    if (genre) query.genre = genre;
    if (type) query.type = type;

    const movies = await Movie.find(query)
      .sort({ createdAt: -1 })
      .limit(120)
      .select('title description genre year duration language poster trailerUrl type featured views episodes.title episodes.season episodes.episode episodes.duration episodes.videoUrl episodes.videoLink createdAt updatedAt')
      .lean();

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(movies.map(serializeMovieSummary));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/home', async (req, res) => {
  try {
    const summaryFields = 'title description genre year duration language poster trailerUrl type featured views episodes.title episodes.season episodes.episode episodes.duration episodes.videoUrl episodes.videoLink createdAt updatedAt';
    const [featured, latest, recommended] = await Promise.all([
      Movie.find({ featured: true }).limit(5).select(summaryFields).lean(),
      Movie.find({}).sort({ createdAt: -1 }).limit(20).select(summaryFields).lean(),
      Movie.find({}).sort({ views: -1 }).limit(10).select(summaryFields).lean(),
    ]);

    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json({
      featured: featured.map(serializeMovieSummary),
      latest: latest.map(serializeMovieSummary),
      recommended: recommended.map(serializeMovieSummary),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/featured', async (req, res) => {
  try {
    const user = await optionalAuth(req);
    const movies = await Movie.find({ featured: true }).limit(5).select('-viewedIPs');
    res.json(movies.map((movie) => serializeMovie(movie, user)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/my', protect, authorOrAdmin, async (req, res) => {
  try {
    const query = req.user.role === 'admin' ? {} : { authorId: req.user.id };
    const movies = await Movie.find(query).sort({ createdAt: -1 });
    res.json(movies.map((movie) => serializeMovie(movie, req.user)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id/stream', protect, requireSubscription, async (req, res) => {
  try {
    const { deviceId, episodeId } = req.query;
    const token = req.headers.authorization?.split(' ')[1] || null;
    const activeStream = await ensureActiveStream(req.user.id, deviceId, req.params.id);
    if (!activeStream.ok) {
      return res.status(activeStream.status).json({ message: activeStream.message });
    }

    const movie = await Movie.findById(req.params.id).select('videoUrl videoLink episodes');
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const source = episodeId ? movie.episodes.id(episodeId) : movie;
    if (!source || !hasVideoSource(source)) {
      return res.status(404).json({ message: 'Video not found' });
    }

    return res.json(buildPlaybackSource(movie._id, source, deviceId, token, episodeId));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await optionalAuth(req);
    const movie = await Movie.findById(req.params.id);

    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    return res.json(serializeMovie(movie, user));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/:id/view', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const movie = await Movie.findByIdAndUpdate(
      req.params.id,
      {
        $inc: { views: 1 },
        ...(ip ? { $addToSet: { viewedIPs: ip } } : {}),
      },
      {
        new: true,
        select: 'views',
      },
    );

    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    return res.json({ views: movie.views });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post(
  '/',
  protect,
  authorOrAdmin,
  upload.fields([{ name: 'poster' }, { name: 'video' }]),
  async (req, res) => {
    const uploadedAssets = [];

    try {
      const { title, description, genre, year, duration, language, featured, type, videoLink, cast } = req.body;
      const posterAsset = req.files?.poster?.[0]
        ? await uploadAsset(req.files.poster[0], { folder: 'posters', resourceType: 'image' })
        : null;
      const videoAsset = req.files?.video?.[0]
        ? await uploadAsset(req.files.video[0], { folder: 'videos', resourceType: 'video' })
        : null;

      uploadedAssets.push(posterAsset, videoAsset);

      const movie = await Movie.create({
        title,
        description,
        genre: genre ? genre.split(',').map((value) => value.trim()) : [],
        year: Number(year) || undefined,
        duration,
        language,
        type: type || 'movie',
        featured: req.user.role === 'admin' && featured === 'true',
        poster: posterAsset?.ref || null,
        videoUrl: videoAsset?.ref || null,
        videoLink: videoLink || null,
        trailerUrl: req.body.trailerUrl || null,
        cast: cast ? cast.split(',').map((value) => value.trim()).filter(Boolean) : [],
        authorId: req.user.id,
      });

      return res.status(201).json(movie);
    } catch (err) {
      await cleanupUploadedAssets(uploadedAssets);
      return res.status(500).json({ message: err.message });
    }
  },
);

router.put(
  '/:id',
  protect,
  authorOrAdmin,
  upload.fields([{ name: 'poster' }, { name: 'video' }]),
  async (req, res) => {
    const uploadedAssets = [];
    const staleAssets = [];

    try {
      const movie = await Movie.findById(req.params.id);
      if (!movie) {
        return res.status(404).json({ message: 'Not found' });
      }

      if (!canEdit(movie, req.user)) {
        return res.status(403).json({ message: 'Not your movie' });
      }

      const { title, description, genre, year, duration, language, featured, type, videoLink } = req.body;

      if (title) movie.title = title;
      if (description) movie.description = description;
      if (genre) movie.genre = genre.split(',').map((value) => value.trim());
      if (year) movie.year = Number(year);
      if (duration) movie.duration = duration;
      if (language) movie.language = language;
      if (type) movie.type = type;
      if (videoLink !== undefined) movie.videoLink = videoLink || null;
      if (req.body.trailerUrl !== undefined) movie.trailerUrl = req.body.trailerUrl || null;
      if (req.user.role === 'admin' && featured !== undefined) {
        movie.featured = featured === 'true';
      }
      if (req.files?.poster?.[0]) {
        const posterAsset = await uploadAsset(req.files.poster[0], { folder: 'posters', resourceType: 'image' });
        uploadedAssets.push(posterAsset);
        if (movie.poster) staleAssets.push({ ref: movie.poster, resourceType: 'image' });
        movie.poster = posterAsset.ref;
      }
      if (req.files?.video?.[0]) {
        const videoAsset = await uploadAsset(req.files.video[0], { folder: 'videos', resourceType: 'video' });
        uploadedAssets.push(videoAsset);
        if (movie.videoUrl) staleAssets.push({ ref: movie.videoUrl, resourceType: 'video' });
        movie.videoUrl = videoAsset.ref;
      }

      await movie.save();
      await Promise.all(staleAssets.map((asset) => safeDeleteAsset(asset.ref, asset)));
      return res.json(movie);
    } catch (err) {
      await cleanupUploadedAssets(uploadedAssets);
      return res.status(500).json({ message: err.message });
    }
  },
);

router.delete('/:id', protect, authorOrAdmin, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (!canEdit(movie, req.user)) {
      return res.status(403).json({ message: 'Not your movie' });
    }

    const staleAssets = [
      movie.poster ? { ref: movie.poster, resourceType: 'image' } : null,
      movie.videoUrl ? { ref: movie.videoUrl, resourceType: 'video' } : null,
      ...(movie.episodes || [])
        .filter((episode) => episode.videoUrl)
        .map((episode) => ({ ref: episode.videoUrl, resourceType: 'video' })),
    ].filter(Boolean);

    await Movie.findByIdAndDelete(req.params.id);
    await Promise.all(staleAssets.map((asset) => safeDeleteAsset(asset.ref, asset)));
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post(
  '/:id/episodes',
  protect,
  authorOrAdmin,
  upload.single('video'),
  async (req, res) => {
    const uploadedAssets = [];

    try {
      const movie = await Movie.findById(req.params.id);
      if (!movie) {
        return res.status(404).json({ message: 'Not found' });
      }

      if (!canEdit(movie, req.user)) {
        return res.status(403).json({ message: 'Not your movie' });
      }

      const { title, episode, season, duration, videoLink } = req.body;
      const videoAsset = req.file
        ? await uploadAsset(req.file, { folder: 'episodes', resourceType: 'video' })
        : null;
      uploadedAssets.push(videoAsset);

      movie.episodes.push({
        title,
        episode: Number(episode),
        season: Number(season) || 1,
        duration,
        videoUrl: videoAsset?.ref || null,
        videoLink: videoLink || null,
      });
      movie.episodes.sort((left, right) => left.season - right.season || left.episode - right.episode);

      await movie.save();
      return res.status(201).json(movie);
    } catch (err) {
      await cleanupUploadedAssets(uploadedAssets);
      return res.status(500).json({ message: err.message });
    }
  },
);

router.put(
  '/:id/episodes/:epId',
  protect,
  authorOrAdmin,
  upload.single('video'),
  async (req, res) => {
    const uploadedAssets = [];
    const staleAssets = [];

    try {
      const movie = await Movie.findById(req.params.id);
      if (!movie) {
        return res.status(404).json({ message: 'Not found' });
      }

      if (!canEdit(movie, req.user)) {
        return res.status(403).json({ message: 'Not your movie' });
      }

      const episode = movie.episodes.id(req.params.epId);
      if (!episode) {
        return res.status(404).json({ message: 'Episode not found' });
      }

      const { title, episode: episodeNumber, season, duration, videoLink } = req.body;
      if (title) episode.title = title;
      if (episodeNumber) episode.episode = Number(episodeNumber);
      if (season) episode.season = Number(season);
      if (duration) episode.duration = duration;
      if (videoLink !== undefined) episode.videoLink = videoLink || null;
      if (req.file) {
        const videoAsset = await uploadAsset(req.file, { folder: 'episodes', resourceType: 'video' });
        uploadedAssets.push(videoAsset);
        if (episode.videoUrl) staleAssets.push({ ref: episode.videoUrl, resourceType: 'video' });
        episode.videoUrl = videoAsset.ref;
      }

      await movie.save();
      await Promise.all(staleAssets.map((asset) => safeDeleteAsset(asset.ref, asset)));
      return res.json(movie);
    } catch (err) {
      await cleanupUploadedAssets(uploadedAssets);
      return res.status(500).json({ message: err.message });
    }
  },
);

router.delete('/:id/episodes/:epId', protect, authorOrAdmin, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (!canEdit(movie, req.user)) {
      return res.status(403).json({ message: 'Not your movie' });
    }

    const episode = movie.episodes.id(req.params.epId);
    const staleAsset = episode?.videoUrl
      ? { ref: episode.videoUrl, resourceType: 'video' }
      : null;
    movie.episodes.pull(req.params.epId);
    await movie.save();
    if (staleAsset) {
      await safeDeleteAsset(staleAsset.ref, staleAsset);
    }
    return res.json(movie);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
