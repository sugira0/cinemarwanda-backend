const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Actor = require('../models/Actor');
const AuthOtp = require('../models/AuthOtp');
const { sendDeviceRemovalEmail, sendOneTimePasswordEmail } = require('../utils/mailer');
const {
  EXPIRY_MINUTES,
  MAX_ATTEMPTS: MAX_DEVICE_VERIFICATION_ATTEMPTS,
  clearVerification,
  createVerificationRequest,
  isExpired,
  isMatchingCode,
  maskEmail,
  maskPhone,
} = require('../utils/deviceRemovalVerification');
const {
  MAX_OTP_ATTEMPTS,
  OTP_EXPIRY_MINUTES,
  createOtpRecord,
  isMatchingOtp,
  isOtpExpired,
} = require('../utils/oneTimePassword');
const { sendDeviceRemovalWhatsapp } = require('../utils/whatsapp');
const { getRequestToken, resolveAuthToken } = require('../middleware/auth');
const {
  buildIdentifierQueries,
  isPhoneProxyEmail,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
  publicContact,
  sanitizeEmail,
} = require('../utils/authContact');
const { buildDeviceSnapshot } = require('../utils/deviceContext');

const SECRET = process.env.JWT_SECRET;
const MAX_DEVICES = 2;
const MIN_PASSWORD_LENGTH = 6;

const signToken = (user, deviceId) =>
  jwt.sign({ id: user._id, role: user.role, deviceId }, SECRET, { expiresIn: '30d' });

const safeUser = (user, extra = {}) => ({
  id: user._id,
  name: user.name,
  email: sanitizeEmail(user.email),
  phone: user.phone || null,
  contact: publicContact(user),
  role: user.role,
  subscription: user.subscription || { plan: 'free', active: false },
  ...extra,
});

async function findActorId(user) {
  if (user.role !== 'actor') return null;
  let actor = await Actor.findOne({ userId: user._id });
  if (!actor) actor = await Actor.create({ name: user.name, userId: user._id });
  return actor._id;
}

async function attachDevice(user, req, deviceId) {
  const dId = deviceId || req.body.deviceId || `dev_${Date.now()}`;
  const deviceSnapshot = buildDeviceSnapshot(req, {
    deviceName: req.body.deviceName,
    deviceLocation: req.body.deviceLocation,
    deviceMeta: req.body.deviceMeta,
  });
  const existingDevice = user.devices.find((device) => device.deviceId === dId)
    || user.devices.find((device) =>
      device.deviceName
      && device.deviceName === deviceSnapshot.deviceName
      && (
        (device.platform && deviceSnapshot.platform && device.platform === deviceSnapshot.platform)
        || (device.userAgent && deviceSnapshot.userAgent && device.userAgent === deviceSnapshot.userAgent)
        || (device.lastIp && deviceSnapshot.lastIp && device.lastIp === deviceSnapshot.lastIp)
        || deviceSnapshot.deviceName === 'Expo Go mobile'
      )
    );

  if (existingDevice) {
    existingDevice.deviceId = dId;
    existingDevice.deviceName = deviceSnapshot.deviceName;
    existingDevice.lastSeen = deviceSnapshot.lastSeen;
    existingDevice.lastIp = deviceSnapshot.lastIp;
    existingDevice.userAgent = deviceSnapshot.userAgent;
    existingDevice.platform = deviceSnapshot.platform;
    existingDevice.language = deviceSnapshot.language;
    existingDevice.location = deviceSnapshot.location;
  } else {
    if (user.devices.length >= MAX_DEVICES) {
      if (user.role === 'admin') {
        user.devices.sort((left, right) => new Date(left.lastSeen || 0) - new Date(right.lastSeen || 0));
        user.devices.shift();
      } else {
        return {
          limited: true,
          deviceId: dId,
          devices: user.devices.map((device) => ({
            deviceId: device.deviceId,
            deviceName: device.deviceName,
            lastSeen: device.lastSeen,
            locationLabel: device.location?.label || null,
          })),
        };
      }
    }

    user.devices.push({ deviceId: dId, ...deviceSnapshot });
  }

  await user.save();
  return { limited: false, deviceId: dId };
}

function normalizeRole(role) {
  const allowed = ['author', 'actor'];
  return allowed.includes(role) ? role : 'viewer';
}

function hasStrongEnoughPassword(password) {
  return String(password || '').length >= MIN_PASSWORD_LENGTH;
}

function getAdminSetupSecret() {
  return process.env.ADMIN_SETUP_TOKEN || process.env.SEED_ADMIN_PASSWORD || process.env.JWT_SECRET || '';
}

function getSubmittedSetupToken(req) {
  return String(req.body.setupToken || req.headers['x-admin-setup-token'] || '').trim();
}

function isValidSetupToken(req) {
  const expected = getAdminSetupSecret();
  const submitted = getSubmittedSetupToken(req);
  return Boolean(expected && submitted && submitted === expected);
}

function getOtpErrorMessage(purpose) {
  if (purpose === 'register') {
    return {
      notFound: 'No sign-up verification code was found. Request a new code to continue.',
      expired: 'Your sign-up code has expired. Request a new one and try again.',
      tooManyAttempts: 'Too many failed sign-up attempts. Request a new code.',
      invalid: 'The sign-up code is incorrect.',
    };
  }

  return {
    notFound: 'No password reset code was found. Request a new code to continue.',
    expired: 'Your password reset code has expired. Request a new one and try again.',
    tooManyAttempts: 'Too many failed reset attempts. Request a new code.',
    invalid: 'The password reset code is incorrect.',
  };
}

async function findUserByIdentifier(identifier) {
  const queries = buildIdentifierQueries(identifier);
  if (!queries.length) return null;
  if (queries.length === 1) return User.findOne(queries[0]);
  return User.findOne({ $or: queries });
}

async function findOrCreateFirebaseUser(decoded, req) {
  const email = normalizeEmail(decoded.email || req.body.email);
  if (!email || !isValidEmail(email)) {
    const err = new Error('Firebase account must include a valid email address.');
    err.statusCode = 400;
    throw err;
  }

  const normalizedPhone = normalizePhone(req.body.phone);
  const resolvedRole = normalizeRole(req.body.role);
  let user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      { email },
      ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
    ],
  });

  if (!user) {
    user = await User.create({
      firebaseUid: decoded.uid,
      name: String(req.body.name || decoded.name || email.split('@')[0]).trim(),
      email,
      phone: normalizedPhone || undefined,
      role: resolvedRole,
    });
  } else {
    if (!user.firebaseUid) user.firebaseUid = decoded.uid;
    if (req.body.name) user.name = String(req.body.name).trim();
    if (normalizedPhone && !user.phone) user.phone = normalizedPhone;
    if (req.body.role && user.role === 'viewer') user.role = resolvedRole;
    await user.save();
  }

  return user;
}

function firebaseApiErrorMessage(code) {
  const messages = {
    EMAIL_EXISTS: 'This email is already registered. Please sign in instead.',
    EMAIL_NOT_FOUND: 'No Firebase account was found for this email.',
    INVALID_LOGIN_CREDENTIALS: 'Invalid email or password.',
    INVALID_PASSWORD: 'Invalid email or password.',
    USER_DISABLED: 'This Firebase account has been disabled.',
    WEAK_PASSWORD: 'Password must be at least 6 characters.',
    OPERATION_NOT_ALLOWED: 'Email/password sign-in is not enabled in Firebase Authentication.',
  };

  return messages[code] || code || 'Firebase request failed.';
}

async function firebaseAuthRequest(action, payload) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    const err = new Error('FIREBASE_WEB_API_KEY is missing on the backend.');
    err.statusCode = 500;
    throw err;
  }

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(firebaseApiErrorMessage(data.error?.message));
    err.statusCode = response.status >= 500 ? 502 : 400;
    err.firebaseCode = data.error?.message;
    throw err;
  }

  return data;
}

async function createFirebaseSessionPayload(user, req, tokenData) {
  if (user.status === 'suspended') {
    const err = new Error('Your account has been suspended. Contact support.');
    err.statusCode = 403;
    throw err;
  }

  const deviceResult = await attachDevice(user, req);
  if (deviceResult.limited) {
    const err = new Error(`This account is already registered on ${MAX_DEVICES} devices. Remove a device to continue.`);
    err.statusCode = 403;
    err.devices = deviceResult.devices;
    throw err;
  }

  const actorId = await findActorId(user);
  return {
    token: tokenData.idToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    deviceId: deviceResult.deviceId,
    user: safeUser(user, { actorId }),
  };
}

async function signInExistingFirebaseAccount(email, password) {
  return firebaseAuthRequest('signInWithPassword', {
    email,
    password,
    returnSecureToken: true,
  });
}

function serializeDevices(user, currentDeviceId) {
  return user.devices.map((device) => ({
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    lastSeen: device.lastSeen,
    locationLabel: device.location?.label || null,
    locationSource: device.location?.source || 'unknown',
    isCurrent: device.deviceId === currentDeviceId,
  }));
}

function getRemovalContacts(user) {
  const email = sanitizeEmail(user.email);
  const phone = normalizePhone(user.phone);

  if (!email) {
    return null;
  }

  return { email, phone: phone || null };
}

async function resolveDeviceRemovalUser(req) {
  const token = getRequestToken(req);

  if (token) {
    const auth = await resolveAuthToken(token);
    if (!auth) return res.status(401).json({ message: 'Invalid token' });
    const user = auth?.user || (auth?.userId ? await User.findById(auth.userId) : null);
    return { user, currentDeviceId: req.body.deviceId || auth?.deviceId || null };
  }

  const { identifier, email, phone, password } = req.body;
  const lookupValue = identifier || email || phone;
  if (!lookupValue || !password) return null;

  const user = await findUserByIdentifier(lookupValue);

  if (!user?.password || !(await bcrypt.compare(password, user.password))) {
    return null;
  }

  return { user, currentDeviceId: null };
}

router.post('/firebase/session', async (req, res) => {
  try {
    const auth = await resolveAuthToken(getRequestToken(req));
    if (!auth || auth.source !== 'firebase') {
      return res.status(401).json({ message: 'Valid Firebase token required' });
    }

    const user = await findOrCreateFirebaseUser(auth.decoded, req);

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }

    const deviceResult = await attachDevice(user, req);
    if (deviceResult.limited) {
      return res.status(403).json({
        message: `This account is already registered on ${MAX_DEVICES} devices. Remove a device to continue.`,
        devices: deviceResult.devices,
      });
    }

    const actorId = await findActorId(user);
    res.json({ deviceId: deviceResult.deviceId, user: safeUser(user, { actorId }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post('/firebase/register', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();

    if (!name) return res.status(400).json({ message: 'Enter your full name.' });
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    let createdAccount = true;
    let tokenData;

    try {
      tokenData = await firebaseAuthRequest('signUp', {
        email: normalizedEmail,
        password,
        displayName: name,
        returnSecureToken: true,
      });
    } catch (firebaseError) {
      if (firebaseError.firebaseCode !== 'EMAIL_EXISTS') throw firebaseError;
      createdAccount = false;
      tokenData = await signInExistingFirebaseAccount(normalizedEmail, password);
    }

    let verificationEmailSent = true;
    let verificationEmailWarning = null;

    if (createdAccount) {
      await firebaseAuthRequest('sendOobCode', {
        requestType: 'VERIFY_EMAIL',
        idToken: tokenData.idToken,
      }).catch((error) => {
        verificationEmailSent = false;
        verificationEmailWarning = error.message;
        console.warn(`Firebase verification email failed: ${error.message}`);
      });
    } else {
      verificationEmailSent = false;
      verificationEmailWarning = 'Account already existed, so no new verification email was sent.';
    }

    const user = await findOrCreateFirebaseUser({
      uid: tokenData.localId,
      email: tokenData.email,
      name,
    }, req);

    const payload = await createFirebaseSessionPayload(user, req, tokenData);
    res.status(201).json({
      ...payload,
      verificationEmailSent,
      verificationEmailWarning,
      message: !createdAccount
        ? 'This email already had an account, so we signed you in.'
        : verificationEmailSent
        ? 'Your account was created. Firebase sent a verification link to your email.'
        : 'Your account was created, but Firebase could not send the verification email. You can still sign in while we check the email template settings.',
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      ...(err.devices ? { devices: err.devices } : {}),
    });
  }
});

router.post('/firebase/register/request-otp', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role,
      deviceId,
      deviceName,
      deviceLocation,
      deviceMeta,
      deferPassword,
    } = req.body;

    const trimmedName = String(name || '').trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!trimmedName) {
      return res.status(400).json({ message: 'Enter your full name.' });
    }

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address to receive your sign-up code.' });
    }

    if (phone && !normalizedPhone) {
      return res.status(400).json({ message: 'Enter a valid Rwanda mobile number like +2507XXXXXXXX.' });
    }

    if (!deferPassword && !hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const deviceSnapshot = buildDeviceSnapshot(req, {
      deviceName,
      deviceLocation,
      deviceMeta,
    });
    const code = await saveOtp({
      purpose: 'register',
      email: normalizedEmail,
      payload: {
        name: trimmedName,
        email: normalizedEmail,
        phone: normalizedPhone || null,
        password,
        role: normalizeRole(role),
        deviceId: deviceId || `dev_${Date.now()}`,
        deviceSnapshot,
      },
    });

    await sendOneTimePasswordEmail({
      to: normalizedEmail,
      name: trimmedName,
      code,
      purpose: 'register',
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });

    res.json({
      message: 'We sent a one-time password to your email. Enter it below to finish creating your account.',
      maskedEmail: maskEmail(normalizedEmail),
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

router.post('/firebase/register/verify-otp', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const errorMessages = getOtpErrorMessage('register');

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: 'Enter the email address and sign-up code.' });
    }

    const pendingOtp = await AuthOtp.findOne({ purpose: 'register', email: normalizedEmail });
    if (!pendingOtp) {
      return res.status(400).json({ message: errorMessages.notFound });
    }

    if (isOtpExpired(pendingOtp)) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: errorMessages.expired });
    }

    if (pendingOtp.attempts >= MAX_OTP_ATTEMPTS) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(429).json({ message: errorMessages.tooManyAttempts });
    }

    if (!isMatchingOtp(otp, pendingOtp.codeHash)) {
      const tooManyAttemptsMessage = await incrementOtpAttempts(pendingOtp, errorMessages.tooManyAttempts);
      return res.status(400).json({
        message: tooManyAttemptsMessage || errorMessages.invalid,
      });
    }

    const payload = pendingOtp.payload || {};
    if (!payload.name || !payload.email || !payload.password) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'This sign-up session is incomplete. Request a new code.' });
    }

    let tokenData;
    try {
      tokenData = await firebaseAuthRequest('signUp', {
        email: payload.email,
        password: payload.password,
        displayName: payload.name,
        returnSecureToken: true,
      });
    } catch (firebaseError) {
      if (firebaseError.firebaseCode !== 'EMAIL_EXISTS') throw firebaseError;
      tokenData = await signInExistingFirebaseAccount(payload.email, payload.password);
    }

    const user = await findOrCreateFirebaseUser({
      uid: tokenData.localId,
      email: tokenData.email || payload.email,
      name: payload.name,
    }, {
      ...req,
      body: {
        ...req.body,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        role: payload.role,
        deviceId: payload.deviceId,
      },
    });

    const deviceReq = {
      ...req,
      body: {
        ...req.body,
        deviceId: payload.deviceId,
        deviceName: payload.deviceSnapshot?.deviceName,
        deviceLocation: payload.deviceSnapshot?.location,
        deviceMeta: {
          platform: payload.deviceSnapshot?.platform,
          language: payload.deviceSnapshot?.language,
        },
      },
    };
    const session = await createFirebaseSessionPayload(user, deviceReq, tokenData);
    await AuthOtp.deleteOne({ _id: pendingOtp._id });

    res.status(201).json({
      ...session,
      message: 'Email verified. Your account is ready.',
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      ...(err.devices ? { devices: err.devices } : {}),
    });
  }
});

router.post('/firebase/login', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email || req.body.identifier);
    const password = String(req.body.password || '');

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'Enter your email and password.' });
    }

    const tokenData = await firebaseAuthRequest('signInWithPassword', {
      email: normalizedEmail,
      password,
      returnSecureToken: true,
    });

    const user = await findOrCreateFirebaseUser({
      uid: tokenData.localId,
      email: tokenData.email,
      name: tokenData.displayName,
    }, req);

    const payload = await createFirebaseSessionPayload(user, req, tokenData);
    res.json(payload);
  } catch (err) {
    res.status(err.statusCode || 500).json({
      message: err.message,
      ...(err.devices ? { devices: err.devices } : {}),
    });
  }
});

router.post('/firebase/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    await firebaseAuthRequest('sendOobCode', {
      requestType: 'PASSWORD_RESET',
      email: normalizedEmail,
    });

    res.json({ message: 'Password reset email sent. Check your inbox.' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

async function saveOtp({ purpose, email, payload }) {
  const { code, otp } = createOtpRecord({ purpose, email, payload });

  await AuthOtp.findOneAndUpdate(
    { purpose, email },
    otp,
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );

  return code;
}

async function incrementOtpAttempts(record, tooManyAttemptsMessage) {
  record.attempts += 1;

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await AuthOtp.deleteOne({ _id: record._id });
    return tooManyAttemptsMessage;
  }

  await record.save();
  return null;
}

router.post('/register/request-otp', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role,
      deviceId,
      deviceName,
      deviceLocation,
      deviceMeta,
      deferPassword,
    } = req.body;

    const trimmedName = String(name || '').trim();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    if (!trimmedName) {
      return res.status(400).json({ message: 'Enter your full name.' });
    }

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address to receive your sign-up code.' });
    }

    if (phone && !normalizedPhone) {
      return res.status(400).json({ message: 'Enter a valid Rwanda mobile number like +2507XXXXXXXX.' });
    }

    if (!deferPassword && !hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(400).json({ message: 'Email already in use.' });
    }

    if (normalizedPhone && await User.findOne({ phone: normalizedPhone })) {
      return res.status(400).json({ message: 'Phone number already in use.' });
    }

    const resolvedRole = normalizeRole(role);
    const resolvedDeviceId = deviceId || `dev_${Date.now()}`;
    const deviceSnapshot = buildDeviceSnapshot(req, {
      deviceName,
      deviceLocation,
      deviceMeta,
    });

    const passwordHash = deferPassword ? null : await bcrypt.hash(password, 10);
    const code = await saveOtp({
      purpose: 'register',
      email: normalizedEmail,
      payload: {
        name: trimmedName,
        email: normalizedEmail,
        phone: normalizedPhone || null,
        ...(passwordHash ? { passwordHash } : {}),
        otpVerified: false,
        role: resolvedRole,
        deviceId: resolvedDeviceId,
        deviceSnapshot,
      },
    });

    try {
      await sendOneTimePasswordEmail({
        to: normalizedEmail,
        name: trimmedName,
        code,
        purpose: 'register',
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });
    } catch (deliveryError) {
      await AuthOtp.deleteOne({ purpose: 'register', email: normalizedEmail });
      return res.status(500).json({
        message: `Failed to send sign-up code. ${deliveryError.message}`,
      });
    }

    res.json({
      message: 'We sent a one-time password to your email. Enter it below to finish creating your account.',
      maskedEmail: maskEmail(normalizedEmail),
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/register/verify-otp', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const errorMessages = getOtpErrorMessage('register');

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: 'Enter the email address and sign-up code.' });
    }

    const pendingOtp = await AuthOtp.findOne({ purpose: 'register', email: normalizedEmail });
    if (!pendingOtp) {
      return res.status(400).json({ message: errorMessages.notFound });
    }

    if (isOtpExpired(pendingOtp)) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: errorMessages.expired });
    }

    if (pendingOtp.attempts >= MAX_OTP_ATTEMPTS) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(429).json({ message: errorMessages.tooManyAttempts });
    }

    if (!isMatchingOtp(otp, pendingOtp.codeHash)) {
      const tooManyAttemptsMessage = await incrementOtpAttempts(pendingOtp, errorMessages.tooManyAttempts);
      return res.status(400).json({
        message: tooManyAttemptsMessage || errorMessages.invalid,
      });
    }

    const payload = pendingOtp.payload || {};
    if (!payload.name) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'This sign-up session is incomplete. Request a new code.' });
    }

    if (!payload.passwordHash && !req.body.password) {
      pendingOtp.payload = { ...payload, otpVerified: true };
      pendingOtp.markModified('payload');
      await pendingOtp.save();
      return res.json({
        verified: true,
        message: 'Email verified. Set your security password to finish creating your account.',
      });
    }

    if (!payload.passwordHash && req.body.password) {
      if (!hasStrongEnoughPassword(req.body.password)) {
        return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
      }
      payload.passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    if (await User.findOne({ email: normalizedEmail })) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Email already in use.' });
    }

    if (payload.phone && await User.findOne({ phone: payload.phone })) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Phone number already in use.' });
    }

    const deviceId = payload.deviceId || `dev_${Date.now()}`;
    const deviceSnapshot = payload.deviceSnapshot || buildDeviceSnapshot(req, {});
    const accountEmail = payload.email || normalizedEmail;

    const user = await User.create({
      name: payload.name,
      email: accountEmail,
      phone: payload.phone || undefined,
      password: payload.passwordHash,
      role: normalizeRole(payload.role),
      devices: [{ deviceId, ...deviceSnapshot }],
    });

    let actorId = null;
    if (user.role === 'actor') {
      const actor = await Actor.create({ name: user.name, userId: user._id });
      actorId = actor._id;
    }

    await AuthOtp.deleteOne({ _id: pendingOtp._id });

    const token = signToken(user, deviceId);
    res.status(201).json({ token, deviceId, user: safeUser(user, { actorId }) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/register/set-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    if (!hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const pendingOtp = await AuthOtp.findOne({ purpose: 'register', email: normalizedEmail });
    if (!pendingOtp) {
      return res.status(400).json({ message: 'No verified sign-up session was found. Request a new code.' });
    }

    if (isOtpExpired(pendingOtp)) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Your sign-up session has expired. Request a new code.' });
    }

    const payload = pendingOtp.payload || {};
    if (!payload.otpVerified || !payload.name) {
      return res.status(400).json({ message: 'Verify your email code before setting a password.' });
    }

    if (await User.findOne({ email: normalizedEmail })) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Email already in use.' });
    }

    if (payload.phone && await User.findOne({ phone: payload.phone })) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Phone number already in use.' });
    }

    const deviceId = payload.deviceId || `dev_${Date.now()}`;
    const deviceSnapshot = payload.deviceSnapshot || buildDeviceSnapshot(req, {});
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: payload.name,
      email: payload.email || normalizedEmail,
      phone: payload.phone || undefined,
      password: passwordHash,
      role: normalizeRole(payload.role),
      devices: [{ deviceId, ...deviceSnapshot }],
    });

    let actorId = null;
    if (user.role === 'actor') {
      const actor = await Actor.create({ name: user.name, userId: user._id });
      actorId = actor._id;
    }

    await AuthOtp.deleteOne({ _id: pendingOtp._id });

    const token = signToken(user, deviceId);
    return res.status(201).json({ token, deviceId, user: safeUser(user, { actorId }) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/register', (req, res) => {
  res.status(410).json({
    message: 'Registration now requires email verification. Request a sign-up code first.',
  });
});

router.post('/admin/setup', async (req, res) => {
  try {
    if (!isValidSetupToken(req)) {
      return res.status(403).json({ message: 'Invalid admin setup token' });
    }

    const email = normalizeEmail(req.body.email || process.env.SEED_ADMIN_EMAIL);
    const password = String(req.body.password || process.env.SEED_ADMIN_PASSWORD || '');
    const name = String(req.body.name || process.env.SEED_ADMIN_NAME || 'Admin').trim();
    const deviceId = req.body.deviceId || `admin_setup_${Date.now()}`;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid admin email.' });
    }

    if (!hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user = await User.findOne({ email });

    if (user) {
      user.name = name || user.name;
      user.password = passwordHash;
      user.role = 'admin';
      user.status = 'active';
    } else {
      user = new User({
        name: name || 'Admin',
        email,
        password: passwordHash,
        role: 'admin',
        status: 'active',
      });
    }

    const deviceResult = await attachDevice(user, req, deviceId);
    const token = signToken(user, deviceResult.deviceId);

    return res.json({
      message: 'Admin account is ready.',
      token,
      deviceId: deviceResult.deviceId,
      user: safeUser(user),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const {
      identifier,
      email,
      phone,
      password,
      deviceId,
      deviceName,
      deviceLocation,
      deviceMeta,
    } = req.body;
    const lookupValue = identifier || email || phone;

    if (!lookupValue || !password) {
      return res.status(400).json({ message: 'Enter your phone number and pin.' });
    }

    const user = await findUserByIdentifier(lookupValue);

    if (!user?.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Your account has been suspended. Contact support.' });
    }

    const deviceResult = await attachDevice(user, req, deviceId);
    if (deviceResult.limited) {
      return res.status(403).json({
        message: `This account is already registered on ${MAX_DEVICES} devices. Remove a device to continue.`,
        devices: deviceResult.devices,
      });
    }

    let actorId = null;
    if (user.role === 'actor') {
      const actor = await Actor.findOne({ userId: user._id });
      actorId = actor?._id || null;
    }

    const token = signToken(user, deviceResult.deviceId);
    res.json({ token, deviceId: deviceResult.deviceId, user: safeUser(user, { actorId }) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/remove-device', (req, res) => {
  res.status(403).json({
    message: 'Device removal now requires email and WhatsApp verification. Request a verification code first.',
  });
});

router.post('/devices/:deviceId/removal/request', async (req, res) => {
  try {
    const resolved = await resolveDeviceRemovalUser(req);
    if (!resolved?.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const { user, currentDeviceId } = resolved;
    const targetDevice = user.devices.find((device) => device.deviceId === req.params.deviceId);
    if (!targetDevice) {
      return res.status(404).json({ message: 'Device not found' });
    }

    const contacts = getRemovalContacts(user);
    if (!contacts) {
      return res.status(400).json({
        message: 'Device removal requires an email address on the account.',
      });
    }

    const { emailCode, whatsappCode, verification } = createVerificationRequest({
      deviceId: targetDevice.deviceId,
      email: contacts.email,
      phone: contacts.phone,
      initiatedByDeviceId: currentDeviceId,
    });

    user.deviceRemovalVerification = verification;
    await user.save();

    let emailDelivered = false;
    let whatsappDelivered = false;
    const deliveryErrors = [];

    try {
      await sendDeviceRemovalEmail(contacts.email, emailCode, targetDevice.deviceName);
      emailDelivered = true;
    } catch (deliveryError) {
      deliveryErrors.push(`Email: ${deliveryError.message}`);
    }

    if (contacts.phone) {
      try {
        await sendDeviceRemovalWhatsapp(contacts.phone, whatsappCode, targetDevice.deviceName);
        whatsappDelivered = true;
      } catch (deliveryError) {
        deliveryErrors.push(`WhatsApp: ${deliveryError.message}`);
      }
    }

    if (!emailDelivered && !whatsappDelivered) {
      clearVerification(user);
      await user.save();
      return res.status(500).json({
        message: `Failed to send verification code. ${deliveryErrors.join(' ')}`,
      });
    }

    res.json({
      message: whatsappDelivered ? 'Verification codes sent' : 'Email verification code sent',
      requestId: verification.requestId,
      maskedEmail: maskEmail(contacts.email),
      maskedPhone: whatsappDelivered ? maskPhone(contacts.phone) : null,
      channels: {
        email: emailDelivered,
        whatsapp: whatsappDelivered,
      },
      expiresInMinutes: EXPIRY_MINUTES,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/devices/:deviceId/removal/confirm', async (req, res) => {
  try {
    const resolved = await resolveDeviceRemovalUser(req);
    if (!resolved?.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const { user, currentDeviceId } = resolved;
    const { requestId, emailCode, whatsappCode } = req.body;
    const verification = user.deviceRemovalVerification;

    if (!verification || verification.deviceId !== req.params.deviceId || verification.requestId !== requestId) {
      return res.status(400).json({ message: 'No active verification request for this device.' });
    }

    if (isExpired(verification)) {
      clearVerification(user);
      await user.save();
      return res.status(400).json({ message: 'Verification codes have expired. Request new codes and try again.' });
    }

    if (verification.attempts >= MAX_DEVICE_VERIFICATION_ATTEMPTS) {
      clearVerification(user);
      await user.save();
      return res.status(429).json({ message: 'Too many failed attempts. Request new verification codes.' });
    }

    const validEmailCode = isMatchingCode(emailCode, verification.emailCodeHash);
    const validWhatsappCode = isMatchingCode(whatsappCode, verification.whatsappCodeHash);

    if (!String(emailCode || '').trim() && !String(whatsappCode || '').trim()) {
      return res.status(400).json({ message: 'Enter either your email code or your WhatsApp code.' });
    }

    if (!validEmailCode && !validWhatsappCode) {
      verification.attempts += 1;
      await user.save();
      return res.status(400).json({
        message: verification.attempts >= MAX_DEVICE_VERIFICATION_ATTEMPTS
          ? 'Too many failed attempts. Request new verification codes.'
          : 'Neither verification code matches.',
      });
    }

    user.devices = user.devices.filter((device) => device.deviceId !== req.params.deviceId);
    clearVerification(user);
    await user.save();

    res.json({
      message: 'Device removed',
      devices: serializeDevices(user, currentDeviceId),
      removedCurrentDevice: currentDeviceId === req.params.deviceId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/devices/:deviceId', (req, res) => {
  res.status(403).json({
    message: 'Direct device removal is disabled. Use the verification flow instead.',
  });
});

router.get('/devices', async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) return res.status(401).json({ message: 'No token' });

    const auth = await resolveAuthToken(token);
    const user = auth?.user || (auth?.userId ? await User.findById(auth.userId) : null);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json(serializeDevices(user, auth.deviceId || req.query.deviceId || null));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) return res.status(401).json({ message: 'No token' });

    const auth = await resolveAuthToken(token);
    const user = await User.findById(auth.userId).select('-password -devices -sessions -resetToken');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const actorId = await findActorId(user);
    res.json({ user: safeUser(user, { actorId }) });
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
});

router.put('/me', async (req, res) => {
  try {
    const token = getRequestToken(req);
    if (!token) return res.status(401).json({ message: 'No token' });

    const auth = await resolveAuthToken(token);
    if (!auth) return res.status(401).json({ message: 'Invalid token' });
    const user = await User.findById(auth.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const name = String(req.body.name || '').trim();
    const normalizedPhone = req.body.phone ? normalizePhone(req.body.phone) : null;

    if (!name) {
      return res.status(400).json({ message: 'Enter your display name.' });
    }

    if (req.body.phone && !normalizedPhone) {
      return res.status(400).json({ message: 'Enter a valid Rwanda mobile number.' });
    }

    if (normalizedPhone) {
      const existingPhoneUser = await User.findOne({ phone: normalizedPhone, _id: { $ne: user._id } });
      if (existingPhoneUser) {
        return res.status(400).json({ message: 'Phone number already in use.' });
      }
    }

    user.name = name;
    user.phone = normalizedPhone || undefined;
    await user.save();

    const actorId = await findActorId(user);
    res.json({ user: safeUser(user, { actorId }) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/logout', (req, res) => res.json({ message: 'Logged out' }));

router.post('/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const genericMessage = 'If that email exists, a one-time password has been sent.';

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.json({ message: genericMessage });
    }

    if (isPhoneProxyEmail(normalizedEmail)) {
      return res.json({ message: genericMessage });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.json({
        message: genericMessage,
        maskedEmail: maskEmail(normalizedEmail),
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });
    }

    const code = await saveOtp({
      purpose: 'password_reset',
      email: normalizedEmail,
      payload: {
        userId: String(user._id),
      },
    });

    try {
      await sendOneTimePasswordEmail({
        to: normalizedEmail,
        name: user.name,
        code,
        purpose: 'password_reset',
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });
    } catch (deliveryError) {
      await AuthOtp.deleteOne({ purpose: 'password_reset', email: normalizedEmail });
      return res.status(500).json({
        message: `Failed to send password reset code. ${deliveryError.message}`,
      });
    }

    res.json({
      message: genericMessage,
      maskedEmail: maskEmail(normalizedEmail),
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ message: 'Failed to send reset code. Check server email config.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!hasStrongEnoughPassword(password)) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    }

    if (token) {
      const user = await User.findOne({
        resetToken: token,
        resetTokenExpiry: { $gt: new Date() },
      });

      if (!user) return res.status(400).json({ message: 'Reset link is invalid or has expired.' });

      user.password = await bcrypt.hash(password, 10);
      user.resetToken = undefined;
      user.resetTokenExpiry = undefined;
      await user.save();

      return res.json({ message: 'Password reset successfully. You can now log in.' });
    }

    const normalizedEmail = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    const errorMessages = getOtpErrorMessage('password_reset');

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    if (!otp) {
      return res.status(400).json({ message: 'Enter the one-time password we sent to your email.' });
    }

    const pendingOtp = await AuthOtp.findOne({ purpose: 'password_reset', email: normalizedEmail });
    if (!pendingOtp) {
      return res.status(400).json({ message: errorMessages.notFound });
    }

    if (isOtpExpired(pendingOtp)) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: errorMessages.expired });
    }

    if (pendingOtp.attempts >= MAX_OTP_ATTEMPTS) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(429).json({ message: errorMessages.tooManyAttempts });
    }

    if (!isMatchingOtp(otp, pendingOtp.codeHash)) {
      const tooManyAttemptsMessage = await incrementOtpAttempts(pendingOtp, errorMessages.tooManyAttempts);
      return res.status(400).json({
        message: tooManyAttemptsMessage || errorMessages.invalid,
      });
    }

    const user = pendingOtp.payload?.userId
      ? await User.findById(pendingOtp.payload.userId)
      : await User.findOne({ email: normalizedEmail });

    if (!user) {
      await AuthOtp.deleteOne({ _id: pendingOtp._id });
      return res.status(400).json({ message: 'Account not found for this reset request.' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    await AuthOtp.deleteOne({ _id: pendingOtp._id });

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
