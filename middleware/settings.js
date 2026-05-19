const Settings = require('../models/Settings');

const DEFAULTS = {
  maintenanceMode:    false,
  allowRegistrations: true,
  freeEpisodes:       2,
};

// Cache settings for 60s to avoid DB hit on every request
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 60 * 1000;

async function getPlatformSettings() {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;
  try {
    const settings = await Settings.get('platform', DEFAULTS);
    _cache = { ...DEFAULTS, ...settings };
    _cacheTime = now;
    return _cache;
  } catch {
    return DEFAULTS;
  }
}

// Invalidate cache when settings are updated
function invalidateSettingsCache() {
  _cache = null;
  _cacheTime = 0;
}

// ── Maintenance mode middleware ───────────────────────────────────────────────
// Blocks all non-admin requests when maintenanceMode is true
const maintenanceGuard = async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (!settings.maintenanceMode) return next();

    // Allow admin requests through
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role === 'admin') return next();
      } catch {}
    }

    // Allow public settings endpoint so frontend can check maintenance status
    if (req.path === '/api/settings/public' || req.path === '/') return next();

    return res.status(503).json({
      message: 'CINEMA Rwanda is currently under maintenance. Please check back soon.',
      code: 'MAINTENANCE_MODE',
    });
  } catch {
    next(); // fail open — don't block if settings can't be read
  }
};

// ── Registration guard ────────────────────────────────────────────────────────
// Blocks new registrations when allowRegistrations is false
const registrationGuard = async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (settings.allowRegistrations) return next();

    return res.status(403).json({
      message: 'New registrations are currently closed. Please try again later.',
      code: 'REGISTRATIONS_CLOSED',
    });
  } catch {
    next();
  }
};

// ── Free episodes helper ──────────────────────────────────────────────────────
async function getFreeEpisodeCount() {
  const settings = await getPlatformSettings();
  return settings.freeEpisodes ?? DEFAULTS.freeEpisodes;
}

module.exports = { maintenanceGuard, registrationGuard, getFreeEpisodeCount, invalidateSettingsCache, getPlatformSettings };
