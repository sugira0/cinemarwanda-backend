const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

require('dotenv').config();

async function test() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find admin user
    const user = await User.findOne({ email: 'admin@cinemarwanda.com' });
    
    if (!user) {
      console.log('❌ Admin user not found');
      const allUsers = await User.find();
      console.log('All users:', allUsers.map(u => ({ id: u._id, email: u.email, role: u.role })));
    } else {
      console.log('✅ Admin user found:');
      console.log('  Email:', JSON.stringify(user.email));
      console.log('  Role:', user.role);
      console.log('  Has password:', !!user.password);
      
      // Test with different email formats
      const testEmails = ['admin@cinemarwanda.com', 'ADMIN@CINEMARWANDA.COM', 'Admin@Cinemarwanda.Com'];
      for (const testEmail of testEmails) {
        const normalized = testEmail.trim().toLowerCase();
        const match = user.email === normalized;
        console.log(`  Email "${testEmail}" normalized to "${normalized}" - ${match ? '✅' : '❌'}`);
      }
      
      // Test password
      const passwordMatch = await bcrypt.compare('Admin@123', user.password);
      console.log('Password match:', passwordMatch ? '✅ YES' : '❌ NO');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

test();
