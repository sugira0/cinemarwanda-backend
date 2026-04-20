const dotenv = require('dotenv');
const app = require('./app');
const { connectToDatabase } = require('./db');
const seed = require('./seed');

dotenv.config();

connectToDatabase()
  .then(async () => {
    console.log('MongoDB connected');
    await seed();
    app.listen(process.env.PORT || 5000, () =>
      console.log(`Server running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
