const mongoose = require('mongoose');

// Old MongoDB Atlas connection
const OLD_MONGO_URI = 'mongodb+srv://rwandancinema_db_user:4C5wzySES5pwvmGU@cluster0.h0tbwe7.mongodb.net/rwandan_movies?appName=Cluster0';

// New local MongoDB connection
const NEW_MONGO_URI = 'mongodb://localhost:27017/rwandan_movies';

async function migrate() {
  let oldDb, newDb;
  
  try {
    console.log('🔄 Starting migration from old backend to new backend...\n');
    
    // Connect to old database
    console.log('📡 Connecting to old MongoDB Atlas database...');
    oldDb = await mongoose.createConnection(OLD_MONGO_URI).asPromise();
    console.log('✅ Connected to old database\n');
    
    // Connect to new database
    console.log('📡 Connecting to new local MongoDB database...');
    newDb = await mongoose.createConnection(NEW_MONGO_URI).asPromise();
    console.log('✅ Connected to new database\n');
    
    // Get all collections from old database
    const collections = await oldDb.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log(`📊 Found ${collectionNames.length} collections to migrate:`);
    collectionNames.forEach(name => console.log(`   - ${name}`));
    console.log();
    
    let totalDocuments = 0;
    
    // Migrate each collection
    for (const collectionName of collectionNames) {
      console.log(`⏳ Migrating collection: ${collectionName}`);
      
      const oldCollection = oldDb.db.collection(collectionName);
      const newCollection = newDb.db.collection(collectionName);
      
      // Get all documents from old collection
      const documents = await oldCollection.find({}).toArray();
      
      if (documents.length === 0) {
        console.log(`   ✓ No documents to migrate\n`);
        continue;
      }
      
      // Clear new collection first
      await newCollection.deleteMany({});
      
      // Insert all documents into new collection
      if (documents.length > 0) {
        await newCollection.insertMany(documents);
      }
      
      console.log(`   ✓ Migrated ${documents.length} documents\n`);
      totalDocuments += documents.length;
    }
    
    console.log(`\n✅ Migration complete!`);
    console.log(`📊 Total documents migrated: ${totalDocuments}\n`);
    
    // Verify migration
    console.log('🔍 Verifying migration...');
    let verified = true;
    
    for (const collectionName of collectionNames) {
      const oldCount = await oldDb.db.collection(collectionName).countDocuments();
      const newCount = await newDb.db.collection(collectionName).countDocuments();
      
      const status = oldCount === newCount ? '✅' : '❌';
      console.log(`   ${status} ${collectionName}: ${oldCount} → ${newCount}`);
      
      if (oldCount !== newCount) {
        verified = false;
      }
    }
    
    if (verified) {
      console.log('\n✅ Verification passed! All data has been successfully migrated.');
    } else {
      console.log('\n⚠️ Verification failed! Some data may not have been migrated correctly.');
    }
    
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    process.exit(1);
  } finally {
    if (oldDb) await oldDb.close();
    if (newDb) await newDb.close();
    console.log('\n📁 Databases closed');
    process.exit(0);
  }
}

migrate();
