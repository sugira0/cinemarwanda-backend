/**
 * One-time script — force reset admin password in MongoDB.
 * Run: node scripts/resetAdminPassword.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function main() {
    const email = process.env.SEED_ADMIN_EMAIL || 'admin@cinemarwanda.com';
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!password) {
        console.error('SEED_ADMIN_PASSWORD not set in .env');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    const hash = await bcrypt.hash(password, 10);
    const result = await User.findOneAndUpdate(
        { email },
        { $set: { password: hash, role: 'admin', status: 'active' } },
        { new: true }
    );

    if (!result) {
        console.error(`No user found with email: ${email}`);
        process.exit(1);
    }

    console.log(`✅ Password reset for ${email} (role: ${result.role})`);
    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
