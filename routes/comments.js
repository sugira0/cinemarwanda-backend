const jwt = require('jsonwebtoken');
const router = require('express').Router();
const Comment = require('../models/Comment');
const Movie = require('../models/Movie');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const SECRET = process.env.JWT_SECRET || 'cinema_rwanda_secret';

function optionalAuth(req) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    return token ? jwt.verify(token, SECRET) : null;
  } catch {
    return null;
  }
}

router.get('/:movieId', async (req, res) => {
  try {
    const comments = await Comment.find({ movieId: req.params.movieId }).sort({ createdAt: -1 });
    const ratedComments = comments.filter((comment) => comment.rating);
    const avgRating = ratedComments.length
      ? ratedComments.reduce((sum, comment) => sum + comment.rating, 0) / ratedComments.length
      : 0;

    return res.json({
      comments,
      avgRating: Math.round(avgRating * 10) / 10,
      total: comments.length,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/:movieId', async (req, res) => {
  try {
    const viewer = optionalAuth(req);
    const { text, rating, name } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ message: 'Review text required' });
    }

    const commentName = viewer?.name || name?.trim();
    if (!commentName) {
      return res.status(400).json({ message: 'Name required' });
    }

    const comment = await Comment.create({
      movieId: req.params.movieId,
      userId: viewer?.id || null,
      name: commentName,
      text: text.trim(),
      rating: rating ? Number(rating) : undefined,
    });

    const movie = await Movie.findById(req.params.movieId);
    if (movie && String(movie.authorId) !== String(viewer?.id || '')) {
      await Notification.create({
        userId: movie.authorId,
        type: 'comment',
        title: 'New comment on your film',
        message: `Someone commented on "${movie.title}"`,
        link: `/movies/${movie._id}`,
      });
    }

    return res.status(201).json(comment);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ message: 'Not found' });
    }

    if (String(comment.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not allowed' });
    }

    await Comment.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Deleted' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/:id/like', async (req, res) => {
  try {
    const viewer = optionalAuth(req);
    const comment = await Comment.findById(req.params.id);
    if (!comment) {
      return res.status(404).json({ message: 'Not found' });
    }

    const identifier = String(viewer?.id || req.socket.remoteAddress || req.ip);
    const existingIndex = comment.likes.findIndex((value) => String(value) === identifier);

    if (existingIndex === -1) {
      comment.likes.push(identifier);
    } else {
      comment.likes.splice(existingIndex, 1);
    }

    await comment.save();
    return res.json({ likes: comment.likes.length });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
