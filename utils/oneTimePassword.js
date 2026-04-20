const crypto = require('crypto');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

function createOtpCode() {
  return `${crypto.randomInt(0, 10 ** OTP_LENGTH)}`.padStart(OTP_LENGTH, '0');
}

function hashOtpCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

function isMatchingOtp(input, hashedValue) {
  if (!hashedValue) return false;
  return hashOtpCode(input) === hashedValue;
}

function isOtpExpired(record) {
  return !record?.expiresAt || record.expiresAt.getTime() < Date.now();
}

function createOtpRecord({ purpose, email, payload = {} }) {
  const code = createOtpCode();

  return {
    code,
    otp: {
      purpose,
      email,
      codeHash: hashOtpCode(code),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      attempts: 0,
      payload,
    },
  };
}

module.exports = {
  MAX_OTP_ATTEMPTS,
  OTP_EXPIRY_MINUTES,
  createOtpRecord,
  hashOtpCode,
  isMatchingOtp,
  isOtpExpired,
};
