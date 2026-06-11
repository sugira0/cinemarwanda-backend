const dotenv = require('dotenv');
dotenv.config(); // Must run before any module that reads process.env

const app = require('./app');
const { connectToDatabase } = require('./db');
const seed = require('./seed');

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
    console.warn('Starting server without MongoDB connection. Will retry in background.');

    // Start server anyway
    app.listen(process.env.PORT || 5000, () =>
      console.log(`Server running on port ${process.env.PORT || 5000} (MongoDB connection pending)`)
    );

    // Retry MongoDB connection in background
    const retryInterval = setInterval(() => {
      connectToDatabase()
        .then(async () => {
          console.log('MongoDB connected (retry successful)');
          await seed();
          clearInterval(retryInterval);
        })
        .catch(() => {
          // Silent retry - already logged initial error
        });
    }, 30000); // Retry every 30 seconds
  });
