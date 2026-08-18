const { db, admin } = require('../config/firebaseAdmin');
const {
  COLLECTION,
  toPublicLocation,
  listActiveLocations,
  getLocationById,
  ensureLocationsSeeded,
  seedData,
} = require('../utils/locations');

const FALLBACK = seedData.map((loc) => toPublicLocation(loc.id, loc));

async function assertAdmin(req) {
  const userDoc = await db.collection('users').doc(req.user.uid).get();
  const role = userDoc.exists ? userDoc.data().role : req.user.role;
  return role === 'admin';
}

exports.getLocations = async (_req, res) => {
  try {
    const locations = await listActiveLocations();
    res.json({ success: true, locations: locations.length ? locations : FALLBACK });
  } catch (error) {
    res.json({ success: true, locations: FALLBACK, warning: error.message });
  }
};

exports.getLocationById = async (req, res) => {
  try {
    const location = await getLocationById(req.params.id);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    res.json({ success: true, location });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.searchLocations = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const locations = await listActiveLocations();
    const results = q
      ? locations.filter(
          (loc) =>
            loc.name.toLowerCase().startsWith(q) ||
            loc.name.toLowerCase().includes(q) ||
            loc.state.toLowerCase().includes(q) ||
            loc.id.includes(q)
        )
      : locations;
    res.json({ success: true, locations: results });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createLocation = async (req, res) => {
  try {
    if (!(await assertAdmin(req))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const body = req.body || {};
    const id = String(body.id || body.name || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    if (!id || !body.name || !body.center?.lat || !body.center?.lng) {
      return res.status(400).json({
        error: 'id/name and center.lat/center.lng are required',
      });
    }

    const data = {
      id,
      name: body.name,
      state: body.state || '',
      country: body.country || 'IN',
      center: {
        lat: parseFloat(body.center.lat),
        lng: parseFloat(body.center.lng),
      },
      bounds: body.bounds || null,
      type: 'city',
      isActive: body.isActive !== false,
      sortOrder: body.sortOrder ?? 99,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection(COLLECTION).doc(id).set(data);
    res.status(201).json({ success: true, location: toPublicLocation(id, data) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateLocation = async (req, res) => {
  try {
    if (!(await assertAdmin(req))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { id } = req.params;
    const doc = await db.collection(COLLECTION).doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const body = req.body || {};
    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    ['name', 'state', 'country', 'bounds', 'isActive', 'sortOrder'].forEach((key) => {
      if (body[key] !== undefined) update[key] = body[key];
    });
    if (body.center) {
      update.center = {
        lat: parseFloat(body.center.lat),
        lng: parseFloat(body.center.lng),
      };
    }

    await db.collection(COLLECTION).doc(id).update(update);
    const next = await getLocationById(id);
    res.json({ success: true, location: next });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/** Idempotent seed — auth required (any signed-in user for local ops). */
exports.seedLocations = async (req, res) => {
  try {
    await ensureLocationsSeeded();
    const batch = db.batch();
    seedData.forEach((loc) => {
      batch.set(
        db.collection(COLLECTION).doc(loc.id),
        {
          ...loc,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();
    const locations = await listActiveLocations();
    res.json({ success: true, seeded: seedData.length, locations });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
