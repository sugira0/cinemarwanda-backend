const bcrypt = require('bcryptjs');
const User = require('./models/User');

module.exports = async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'Admin';

  if (!email || !password) {
    return;
  }

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    existingUser.name = existingUser.name || name;
    existingUser.password = await bcrypt.hash(password, 10);
    existingUser.role = 'admin';
    existingUser.status = 'active';
    await existingUser.save();
    console.log(`Synced admin account for ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    password: passwordHash,
    role: 'admin',
  });

  console.log(`Seeded admin account for ${email}`);
};
