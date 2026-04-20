const crypto = require('crypto');

const CODE_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function createVerificationCode() {
  return `${crypto.randomInt(0, 10 ** CODE_LENGTH)}`.padStart(CODE_LENGTH, '0');
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

function isMatchingCode(input, hashedValue) {
  if (!hashedValue) return false;
  return hashVerificationCode(input) === hashedValue;
}

function createVerificationRequest({ deviceId, email, phone, initiatedByDeviceId }) {
  const emailCode = createVerificationCode();
  const whatsappCode = createVerificationCode();

  return {
    emailCode,
    whatsappCode,
    verification: {
      requestId: crypto.randomUUID(),
      deviceId,
      emailCodeHash: hashVerificationCode(emailCode),
      whatsappCodeHash: hashVerificationCode(whatsappCode),
      email,
      phone,
      expiresAt: new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000),
      attempts: 0,
      initiatedByDeviceId: initiatedByDeviceId || null,
      initiatedAt: new Date(),
    },
  };
}

function isExpired(verification) {
  return !verification?.expiresAt || verification.expiresAt.getTime() < Date.now();
}

function clearVerification(user) {
  user.deviceRemovalVerification = undefined;
}

function maskEmail(email) {
  if (!email) return null;
  const [localPart, domain] = String(email).split('@');
  if (!domain) return email;

  if (localPart.length <= 2) {
    return `${localPart[0] || '*'}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
}

function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return phone;
  const visibleTail = digits.slice(-4);
  return `+${'*'.repeat(Math.max(digits.length - 4, 4))}${visibleTail}`;
}

module.exports = {
  EXPIRY_MINUTES,
  MAX_ATTEMPTS,
  clearVerification,
  createVerificationRequest,
  isExpired,
  isMatchingCode,
  maskEmail,
  maskPhone,
};
