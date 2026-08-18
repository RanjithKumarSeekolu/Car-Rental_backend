const { db, admin } = require('../config/firebaseAdmin');
const seedData = require('../data/locations.seed.json');
const { encodeGeohash } = require('./geohash');
const { haversineKm, inIndia, MAX_KM_FROM_CITY } = require('./geo');

const COLLECTION = 'locations';

function toPublicLocation(id, data = {}) {
  return {
    id,
    name: data.name || id,
    state: data.state || '',
    country: data.country || 'IN',
    center: data.center || { lat: 0, lng: 0 },
    bounds: data.bounds || null,
    isActive: data.isActive !== false,
    sortOrder: data.sortOrder ?? 99,
    type: data.type || 'city',
  };
}

function isCatalogCity(data = {}, id = '') {
  if (data.isActive === false) return false;
  const lat = data.center?.lat;
  const lng = data.center?.lng;
  const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
  // Catalog cities are typed; legacy place rows without type/state are excluded
  if (data.type === 'city' && hasGeo && data.name) return true;
  const known = seedData.some((s) => s.id === id);
  return known && hasGeo && !!data.name && !!data.state;
}

async function ensureLocationsSeeded() {
  const snap = await db.collection(COLLECTION).limit(1).get();
  if (!snap.empty) return;

  const batch = db.batch();
  seedData.forEach((loc) => {
    const ref = db.collection(COLLECTION).doc(loc.id);
    batch.set(ref, {
      ...loc,
      type: 'city',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();
}

async function listActiveLocations() {
  await ensureLocationsSeeded();
  const snapshot = await db.collection(COLLECTION).get();
  return snapshot.docs
    .filter((doc) => isCatalogCity(doc.data(), doc.id))
    .map((doc) => toPublicLocation(doc.id, doc.data()))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

async function getLocationById(id) {
  if (!id) return null;
  await ensureLocationsSeeded();
  const doc = await db.collection(COLLECTION).doc(String(id).toLowerCase()).get();
  if (!doc.exists) {
    // try match by name slug variants
    const all = await listActiveLocations();
    return all.find((l) => l.id === id || l.name.toLowerCase() === String(id).toLowerCase()) || null;
  }
  return toPublicLocation(doc.id, doc.data());
}

async function resolveCityFromBody(body = {}, { requirePin = false } = {}) {
  let cityId = (body.cityId || '').toString().trim().toLowerCase();
  if (!cityId && body.city) {
    cityId = String(body.city).trim().toLowerCase().replace(/\s+/g, '-');
  }

  const catalog = cityId ? await getLocationById(cityId) : null;

  const loc = body.location || {};
  let lat = parseFloat(loc.lat ?? loc.latitude);
  let lng = parseFloat(loc.lng ?? loc.longitude);
  const hasPin = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  if (!hasPin) {
    if (requirePin) {
      const err = new Error('Place a pickup pin on the map');
      err.status = 400;
      throw err;
    }
    if (catalog?.center) {
      lat = catalog.center.lat;
      lng = catalog.center.lng;
    } else {
      lat = null;
      lng = null;
    }
  }

  if (hasPin || requirePin) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndia(lat, lng)) {
      const err = new Error('Pickup pin must be in India');
      err.status = 400;
      throw err;
    }
    if (catalog?.center) {
      const km = haversineKm({ lat, lng }, { lat: catalog.center.lat, lng: catalog.center.lng });
      if (km > MAX_KM_FROM_CITY) {
        const err = new Error(
          `Pickup is too far from ${catalog.name}. Choose a spot in that city, or pick a different city.`
        );
        err.status = 400;
        throw err;
      }
    }
  }

  const resolved = {
    cityId: catalog?.id || cityId || '',
    city: catalog?.name || body.city || '',
    state: catalog?.state || body.state || '',
    address: body.address || '',
    placeId: body.placeId || null,
    location:
      lat != null && lng != null
        ? { latitude: lat, longitude: lng }
        : { latitude: 0, longitude: 0 },
    geohash: lat != null && lng != null ? encodeGeohash(lat, lng) : '',
  };

  return { resolved, catalog };
}

module.exports = {
  COLLECTION,
  toPublicLocation,
  ensureLocationsSeeded,
  listActiveLocations,
  getLocationById,
  resolveCityFromBody,
  seedData,
};
