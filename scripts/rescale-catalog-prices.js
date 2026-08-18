#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, admin, auth } = require('../src/config/firebaseAdmin');

const JSON_PATH = path.join(__dirname, '../src/controllers/exports/car.json');
const USD_CEILING = 1000;

const BANDS = {
  Hatchback: [1500, 2500],
  Sedan: [2500, 4000],
  SUV: [4000, 7000],
  Minivan: [4000, 6000],
  Convertible: [6000, 10000],
  Electric: [4500, 8000],
  Sports: [8000, 15000],
  Luxury: [10000, 20000],
};

function num(car) {
  return Number(car.pricePerDay ?? car.price_per_day) || 0;
}

function roundTo(n, step = 50) {
  return Math.max(step, Math.round(n / step) * step);
}

function statsByCategory(cars) {
  const stats = {};
  cars.forEach((car) => {
    const cat = car.category || 'Sedan';
    const p = num(car);
    if (!stats[cat]) stats[cat] = { min: p, max: p };
    else {
      stats[cat].min = Math.min(stats[cat].min, p);
      stats[cat].max = Math.max(stats[cat].max, p);
    }
  });
  return stats;
}

function toInr(car, stats) {
  const cat = car.category || 'Sedan';
  const [lo, hi] = BANDS[cat] || BANDS.Sedan;
  const p = num(car);
  const range = stats[cat] || { min: p, max: p };
  if (range.max === range.min) return roundTo((lo + hi) / 2);
  const t = (p - range.min) / (range.max - range.min);
  return roundTo(lo + t * (hi - lo));
}

function applyPrice(car, inr) {
  return { ...car, price_per_day: inr, pricePerDay: inr };
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const seedStats = statsByCategory(seed);
  const nextSeed = seed.map((car) => applyPrice(car, toInr(car, seedStats)));
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(nextSeed, null, 2)}\n`);

  let adminUid = '';
  try {
    adminUid = (await auth.getUserByEmail(process.env.ADMIN_EMAIL || 'admin@rentnhost.com')).uid;
  } catch (_) {
    /* still match platform flag / seed host */
  }

  const snap = await db.collection('car').get();
  const catalogDocs = snap.docs.filter((doc) => {
    const d = doc.data();
    const price = Number(d.pricePerDay ?? d.price_per_day) || 0;
    if (price >= USD_CEILING) return false;
    return (
      d.isPlatformListing === true ||
      d.hostId === 'SEED_USER_ADMIN' ||
      (adminUid && d.hostId === adminUid)
    );
  });

  const live = catalogDocs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const liveStats = statsByCategory(live);

  const SIZE = 400;
  for (let i = 0; i < catalogDocs.length; i += SIZE) {
    const batch = db.batch();
    catalogDocs.slice(i, i + SIZE).forEach((doc) => {
      const inr = toInr(doc.data(), liveStats);
      batch.update(doc.ref, {
        price_per_day: inr,
        pricePerDay: inr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }

  const samples = catalogDocs.slice(0, 8).map((doc) => {
    const d = doc.data();
    return `${d.make || d.brand} ${d.model} (${d.category}): ${num(d)} → ${toInr(d, liveStats)}`;
  });

  console.log(`Updated seed JSON: ${nextSeed.length} cars`);
  console.log(`Updated Firestore catalog: ${catalogDocs.length} cars (skipped host listings ≥ ₹${USD_CEILING})`);
  samples.forEach((line) => console.log(`  ${line}`));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
