const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

async function connectTestDB() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  await mongoose.connect(uri);

  return mongod;
}

async function disconnectTestDB(mongod) {
  await mongoose.disconnect();
  await mongod.stop();
}

async function clearTestDB() {
  const { collections } = mongoose.connection;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
}

module.exports = { connectTestDB, disconnectTestDB, clearTestDB };
