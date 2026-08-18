#!/usr/bin/env node
require('dotenv').config();
const { db, admin } = require('../src/config/firebaseAdmin');
const seedData = require('../src/data/locations.seed.json');

async function main() {
  const batch = db.batch();
  seedData.forEach((loc) => {
    const ref = db.collection('locations').doc(loc.id);
    batch.set(
      ref,
      {
        ...loc,
        type: 'city',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
  await batch.commit();
  console.log(`Seeded ${seedData.length} locations into Firestore "locations" collection.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
