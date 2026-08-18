#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, admin, auth } = require('../src/config/firebaseAdmin');

const JSON_PATH = path.join(__dirname, '../src/controllers/exports/car.json');
const UA = 'RentNHostBot/1.0 (catalog image seed; admin@rentnhost.com)';

const cache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wikiJson(params) {
  const url = `https://en.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(attempt === 0 ? 250 : 1500 * (attempt + 1));
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.status === 429) {
      console.warn(`  wiki 429, retry ${attempt + 1}`);
      continue;
    }
    if (!res.ok) throw new Error(`wiki ${res.status}`);
    return res.json();
  }
  throw new Error('wiki 429');
}

async function thumbForTitle(title) {
  const data = await wikiJson({
    action: 'query',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '1280',
    redirects: '1',
    titles: title,
  });
  const pages = Object.values(data.query?.pages || {});
  for (const page of pages) {
    const src = page.thumbnail?.source;
    if (src && page.pageid && page.pageid !== -1) return src;
  }
  return '';
}

async function searchTitle(query) {
  const data = await wikiJson({
    action: 'query',
    list: 'search',
    srlimit: '5',
    srsearch: query,
  });
  return (data.query?.search || []).map((hit) => hit.title);
}

async function imageForCar(make, model) {
  const key = `${make} ${model}`.trim();
  if (cache.has(key)) return cache.get(key);
  const tries = [
    key,
    `${key} (car)`,
    `${make} ${model} automobile`,
  ];
  let url = '';
  for (const title of tries) {
    url = await thumbForTitle(title);
    if (url) break;
  }
  if (!url) {
    const hits = await searchTitle(`${make} ${model} car`);
    for (const title of hits) {
      url = await thumbForTitle(title);
      if (url) break;
    }
  }
  cache.set(key, url);
  return url;
}

function needsImage(url = '') {
  const u = String(url || '').trim();
  if (!u) return true;
  if (u.startsWith('blob:')) return true;
  if (u.includes('motortrend.com')) return true;
  return false;
}

async function main() {
  const seed = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  let filled = 0;
  const next = [];
  for (const car of seed) {
    const make = String(car.make || car.brand || '').trim();
    const model = String(car.model || '').trim();
    let image = car.image_url || '';
    if (needsImage(image)) {
      const found = await imageForCar(make, model);
      if (found) {
        image = found;
        filled += 1;
        console.log(`  ${make} ${model}: ${found.slice(0, 90)}…`);
      } else {
        console.warn(`  MISSING ${make} ${model}`);
      }
    }
    next.push({
      ...car,
      make,
      model,
      brand: String(car.brand || make).trim(),
      image_url: image,
    });
  }
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(next, null, 2)}\n`);

  const byKey = new Map();
  next.forEach((car) => {
    byKey.set(`${car.make}|${car.model}|${car.year}`.toLowerCase(), car.image_url);
    byKey.set(`${car.make}|${car.model}`.toLowerCase(), car.image_url);
  });

  let adminUid = '';
  try {
    adminUid = (await auth.getUserByEmail(process.env.ADMIN_EMAIL || 'admin@rentnhost.com')).uid;
  } catch (_) {
    /* catalog flag still matches */
  }

  const snap = await db.collection('car').get();
  const updates = [];
  snap.docs.forEach((doc) => {
    const d = doc.data();
    const catalog =
      d.isPlatformListing === true ||
      d.hostId === 'SEED_USER_ADMIN' ||
      (adminUid && d.hostId === adminUid);
    if (!catalog) return;
    const make = String(d.make || d.brand || '').trim();
    const model = String(d.model || '').trim();
    const image =
      byKey.get(`${make}|${model}|${d.year}`.toLowerCase()) ||
      byKey.get(`${make}|${model}`.toLowerCase()) ||
      '';
    if (!image) return;
    if (d.image_url === image) return;
    updates.push({
      ref: doc.ref,
      data: {
        image_url: image,
        make,
        model,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  });

  const SIZE = 400;
  for (let i = 0; i < updates.length; i += SIZE) {
    const batch = db.batch();
    updates.slice(i, i + SIZE).forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }

  console.log(`Seed JSON filled/replaced: ${filled}/${seed.length}`);
  console.log(`Firestore catalog images updated: ${updates.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
