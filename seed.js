const bcrypt = require('bcryptjs');
const User = require('./models/User');

module.exports = async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  if (!email || !password) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    // Always sync role, status, name and password from env
    existingUser.name = name;
    existingUser.role = 'admin';
    existingUser.status = 'active';
    existingUser.password = passwordHash;
    await existingUser.save();
    console.log(`Synced admin account for ${email}`);
    return;
  }

  // First-time creation
  await User.create({
    name,
    email,
    password: passwordHash,
    role: 'admin',
  });

  console.log(`Seeded admin account for ${email}`);
};
