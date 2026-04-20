const PHONE_PROXY_DOMAIN = 'phone.cinemarwanda.local';

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email || null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) return null;

  if (compact.startsWith('+')) {
    const digits = compact.slice(1).replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('2507')) {
      return `+${digits}`;
    }
    return null;
  }

  const digits = compact.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('2507')) {
    return `+${digits}`;
  }
  if (digits.length === 10 && digits.startsWith('07')) {
    return `+250${digits.slice(1)}`;
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    return `+250${digits}`;
  }

  return null;
}

function buildPhoneProxyEmail(phone) {
  return `phone-${phone.replace(/\D/g, '')}@${PHONE_PROXY_DOMAIN}`;
}

function isPhoneProxyEmail(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && normalized.endsWith(`@${PHONE_PROXY_DOMAIN}`));
}

function sanitizeEmail(email) {
  const normalized = normalizeEmail(email);
  return isPhoneProxyEmail(normalized) ? null : normalized;
}

function publicContact(user) {
  return sanitizeEmail(user?.email) || user?.phone || null;
}

function buildIdentifierQueries(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return [];

  const queries = [];
  const email = normalizeEmail(value);
  const phone = normalizePhone(value);

  if (value.includes('@') && email) {
    queries.push({ email });
  }
  if (phone) {
    queries.push({ phone });
  }

  return queries;
}

module.exports = {
  buildIdentifierQueries,
  buildPhoneProxyEmail,
  isPhoneProxyEmail,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  publicContact,
  sanitizeEmail,
};
