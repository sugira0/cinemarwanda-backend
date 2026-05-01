function cleanText(value, maxLength = 160) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function roundNumber(value, digits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(digits));
}

function normalizeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeIp(value) {
  const raw = cleanText(Array.isArray(value) ? value[0] : value, 120);
  if (!raw) return null;

  let normalized = raw.split(',')[0].trim();
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }

  if (normalized === '::1' || normalized === '127.0.0.1') {
    return null;
  }

  return normalized || null;
}

function getRequestIp(req) {
  const headers = req?.headers || {};

  return normalizeIp(
    headers['x-forwarded-for']
      || headers['x-real-ip']
      || req?.ip
      || req?.socket?.remoteAddress
      || req?.connection?.remoteAddress
  );
}

function buildLocationLabel({ city, region, country, latitude, longitude, timezone, ip }) {
  const areaLabel = [city, region, country].filter(Boolean).join(', ');
  if (areaLabel) return areaLabel;

  if (latitude !== null && longitude !== null) {
    return `${latitude}, ${longitude}`;
  }

  if (timezone) return timezone;
  if (ip) return `IP ${ip}`;
  return 'Location unavailable';
}

function normalizeLocation(location, ip) {
  const latitude = roundNumber(location?.latitude);
  const longitude = roundNumber(location?.longitude);
  const accuracy = roundNumber(location?.accuracy, 0);
  const timezone = cleanText(location?.timezone, 80);
  const city = cleanText(location?.city, 80);
  const region = cleanText(location?.region, 80);
  const country = cleanText(location?.country, 80);
  const hasCoordinates = latitude !== null && longitude !== null;
  const label = cleanText(location?.label, 160)
    || buildLocationLabel({ city, region, country, latitude, longitude, timezone, ip });

  return {
    label,
    city,
    region,
    country,
    latitude: hasCoordinates ? latitude : undefined,
    longitude: hasCoordinates ? longitude : undefined,
    accuracy: accuracy !== null ? accuracy : undefined,
    timezone,
    source: hasCoordinates ? 'browser' : (ip ? 'network' : 'unknown'),
    capturedAt: normalizeDate(location?.capturedAt) || new Date(),
  };
}

function buildDeviceSnapshot(req, { deviceName, deviceLocation, deviceMeta } = {}) {
  const headers = req?.headers || {};
  const lastIp = getRequestIp(req);

  return {
    deviceName: cleanText(deviceName, 120) || 'Unknown Device',
    lastSeen: new Date(),
    lastIp: lastIp || undefined,
    userAgent: cleanText(deviceMeta?.userAgent || headers['user-agent'], 500) || undefined,
    platform: cleanText(deviceMeta?.platform, 120) || undefined,
    language: cleanText(deviceMeta?.language, 40) || undefined,
    location: normalizeLocation(deviceLocation, lastIp),
  };
}

module.exports = {
  buildDeviceSnapshot,
};
