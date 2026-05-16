const { getFirebaseAdmin } = require('./firebaseAdmin');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Send a push notification + store in-app notification
 *
 * @param {Object} opts
 * @param {string|string[]} opts.userIds  — MongoDB user IDs to notify
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.type]            — notification type (new_movie, system, etc.)
 * @param {string} [opts.link]            — deep link / URL
 * @param {Object} [opts.data]            — extra data payload
 */
async function sendPushToUsers({ userIds, title, body, type = 'system', link = '', data = {} }) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (!ids.length) return;

  // 1. Store in-app notifications in MongoDB
  const notifications = ids.map(userId => ({
    userId,
    type,
    title,
    message: body,
    link,
    read: false,
  }));
  await Notification.insertMany(notifications).catch(() => {});

  // 2. Collect FCM tokens for all users
  const users = await User.find(
    { _id: { $in: ids }, 'pushTokens.0': { $exists: true } },
    { pushTokens: 1 }
  );

  const tokens = [];
  users.forEach(u => {
    u.pushTokens.forEach(pt => {
      if (pt.token) tokens.push(pt.token);
    });
  });

  if (!tokens.length) return;

  // 3. Send via Firebase Cloud Messaging
  try {
    const admin = getFirebaseAdmin();
    const messaging = admin.messaging();

    // Send in batches of 500 (FCM limit)
    const BATCH = 500;
    for (let i = 0; i < tokens.length; i += BATCH) {
      const batch = tokens.slice(i, i + BATCH);
      await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: { link, type, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) },
        android: {
          priority: 'high',
          notification: { sound: 'default', channelId: 'cinema_rwanda' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
        webpush: {
          notification: { icon: '/icon.png', badge: '/badge.png' },
        },
      }).catch(err => console.warn('FCM batch error:', err.message));
    }
  } catch (err) {
    console.warn('Push notification error:', err.message);
  }
}

/**
 * Broadcast push to ALL users (or filtered by role)
 */
async function broadcastPush({ title, body, type = 'system', link = '', role = null, data = {} }) {
  const filter = { 'pushTokens.0': { $exists: true } };
  if (role) filter.role = role;

  const users = await User.find(filter, { _id: 1 });
  const ids = users.map(u => String(u._id));

  if (!ids.length) return { sent: 0 };

  await sendPushToUsers({ userIds: ids, title, body, type, link, data });
  return { sent: ids.length };
}

module.exports = { sendPushToUsers, broadcastPush };
