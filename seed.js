const bcrypt = require('bcryptjs');
const User = require('./models/User');

module.exports = async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    return;
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    name: process.env.SEED_ADMIN_NAME || 'Admin',
    email,
    password: passwordHash,
    role: 'admin',
  });

  console.log(`Seeded admin account for ${email}`);
};
