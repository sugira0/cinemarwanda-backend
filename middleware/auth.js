const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyFirebaseIdToken } = require('../utils/firebaseAdmin');
const SECRET = process.env.JWT_SECRET || 'cinema_rwanda_secret';

function getRequestToken(req) {
  const headerToken = req.headers.authorization?.split(' ')[1];
  if (headerToken) return headerToken;

  const queryToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return typeof queryToken === 'string' && queryToken.trim() ? queryToken.trim() : null;
}

async function getUserForFirebaseToken(decoded) {
  const email = decoded.email?.toLowerCase();
  let user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      ...(email ? [{ email }] : []),
    ],
  });

  if (!user && email) {
    user = await User.create({
      firebaseUid: decoded.uid,
      name: decoded.name || email.split('@')[0],
      email,
      role: 'viewer',
    });
  } else if (user && !user.firebaseUid) {
    user.firebaseUid = decoded.uid;
    await user.save();
  }

  return user;
}

async function resolveAuthToken(token) {
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, SECRET);
    return { source: 'jwt', decoded, userId: decoded.id, role: decoded.role, deviceId: decoded.deviceId || null };
  } catch {
    const decoded = await verifyFirebaseIdToken(token);
    const user = await getUserForFirebaseToken(decoded);
    if (!user) return null;

    return {
      source: 'firebase',
      decoded,
      userId: String(user._id),
      firebaseUid: decoded.uid,
      role: user.role,
      deviceId: decoded.deviceId || null,
      user,
    };
  }
}

const protect = async (req, res, next) => {
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    const auth = await resolveAuthToken(token);
    if (!auth) return res.status(401).json({ message: 'Invalid token' });
    req.auth = auth;
    req.user = {
      id: auth.userId,
      uid: auth.firebaseUid,
      role: auth.role,
      deviceId: auth.deviceId,
      authSource: auth.source,
    };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin only' });
  next();
};

const authorOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'author' && req.user?.role !== 'admin')
    return res.status(403).json({ message: 'Author or admin only' });
  next();
};

module.exports = { protect, adminOnly, authorOrAdmin, getRequestToken, resolveAuthToken, getUserForFirebaseToken };
