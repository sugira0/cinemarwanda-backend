const app = require('../app');
const { connectToDatabase } = require('../db');

module.exports = async (req, res) => {
  try {
    await connectToDatabase();
    return app(req, res);
  } catch (error) {
    console.error('Vercel API bootstrap error:', error);
    return res.status(500).json({ message: 'Server failed to initialize' });
  }
};
