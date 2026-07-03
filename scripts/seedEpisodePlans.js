require('dotenv').config();
const mongoose = require('mongoose');
const SubscriptionPlan = require('../models/SubscriptionPlan');

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    // Add 7 Episodes Pack
    const ep7 = await SubscriptionPlan.findOne({ id: 'episodes7' });
    if (!ep7) {
        await SubscriptionPlan.create({
            id: 'episodes7',
            name: '7 Episodes Pack',
            description: 'Unlock any 7 episodes or movies for 500 RWF.',
            price: 500,
            durationDays: 30,
            streams: 1,
            features: ['Unlock 7 episodes or movies', 'Valid for 30 days', 'MTN MoMo or Airtel Money', 'No monthly commitment'],
            active: true,
            order: 5,
        });
        console.log('✅ Created: 7 Episodes Pack (500 RWF)');
    } else {
        console.log('ℹ️  Already exists: episodes7');
    }

    // Update ppv to cleaner name
    await SubscriptionPlan.findOneAndUpdate(
        { id: 'ppv' },
        { name: 'Single Episode', description: 'Pay 100 RWF to unlock one movie or episode permanently.', order: 6 }
    );
    console.log('✅ Updated: Single Episode (100 RWF)');

    await mongoose.disconnect();
    console.log('Done ✓');
}

main().catch(err => { console.error(err); process.exit(1); });
