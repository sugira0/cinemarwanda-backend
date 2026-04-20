const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'cinema_rwanda_secret';

function getRequestToken(req) {
  const headerToken = req.headers.authorization?.split(' ')[1];
  if (headerToken) return headerToken;

  const queryToken = Array.isArray(req.query?.token) ? req.query.token[0] : req.query?.token;
  return typeof queryToken === 'string' && queryToken.trim() ? queryToken.trim() : null;
}

const protect = (req, res, next) => {
  const token = getRequestToken(req);
  if (!token) return res.status(401).json({ message: 'No token' });
  try {
    req.user = jwt.verify(token, SECRET);
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

module.exports = { protect, adminOnly, authorOrAdmin };
