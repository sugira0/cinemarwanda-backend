const dns = require('dns');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

let connectionPromise = null;
let dnsConfigured = false;

function configureMongoDns() {
  if (dnsConfigured) {
    return;
  }

  const rawServers = process.env.MONGO_DNS_SERVERS?.trim();
  if (!rawServers) {
    dnsConfigured = true;
    return;
  }

  const servers = rawServers
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  if (!servers.length) {
    dnsConfigured = true;
    return;
  }

  dns.setServers(servers);
  dnsConfigured = true;
}

function annotateMongoError(error) {
  if (
    error?.code === 'ECONNREFUSED' &&
    error?.syscall === 'querySrv' &&
    process.env.MONGO_URI?.startsWith('mongodb+srv://')
  ) {
    error.message = `${error.message}. Node could not resolve the Atlas SRV record with the current DNS servers. Set MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 or switch your network adapter DNS to a resolver that supports SRV lookups.`;
  }

  return error;
}

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured');
  }

  if (!connectionPromise) {
    configureMongoDns();
    connectionPromise = mongoose.connect(process.env.MONGO_URI)
      .then(() => mongoose.connection)
      .catch((error) => {
        connectionPromise = null;
        throw annotateMongoError(error);
      });
  }

  return connectionPromise;
}

module.exports = { connectToDatabase };
