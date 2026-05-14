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
    // Only fix role/status — never overwrite a password the admin may have changed
    let changed = false;
    if (!existingUser.name)          { existingUser.name   = name;    changed = true; }
    if (existingUser.role !== 'admin')  { existingUser.role   = 'admin'; changed = true; }
    if (existingUser.status !== 'active') { existingUser.status = 'active'; changed = true; }
    if (changed) await existingUser.save();
    console.log(`Synced admin account for ${email}`);
    return;
  }

  // First-time creation — set the seed password
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    password: passwordHash,
    role: 'admin',
  });

  console.log(`Seeded admin account for ${email}`);
};
