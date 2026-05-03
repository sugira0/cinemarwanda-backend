require('dotenv').config();

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  const email = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || '');
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  if (!process.env.MONGO_URI || !email || !password) {
    throw new Error('Missing MONGO_URI, SEED_ADMIN_EMAIL, or SEED_ADMIN_PASSWORD.');
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        name,
        email,
        password: passwordHash,
        role: 'admin',
        status: 'active',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  console.log(JSON.stringify({
    ok: true,
    email: user.email,
    role: user.role,
    status: user.status,
    id: String(user._id),
  }));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
