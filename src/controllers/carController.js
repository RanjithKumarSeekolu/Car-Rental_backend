const { db, admin } = require('../config/firebaseAdmin');

const { uploadMultipleImages, deleteImage } = require('../services/storageService');
const { resolveCityFromBody } = require('../utils/locations');
const { toMillis, toIso, isBlobUrl } = require('../utils/timestamps');
const { kycVerified } = require('../utils/kyc');

const COLLECTION = 'car';
const USERS_COLLECTION = 'users';
const DATE_SORT_FIELDS = new Set(['createdAt', 'updatedAt']);
const SNAPSHOT_TTL_MS = 30_000;

let carSnapshot = null;
let carSnapshotAt = 0;

function invalidateCarSnapshot() {
  carSnapshot = null;
  carSnapshotAt = 0;
}

async function loadCarSnapshot() {
  if (carSnapshot && Date.now() - carSnapshotAt < SNAPSHOT_TTL_MS) {
    return carSnapshot;
  }
  const snapshot = await db.collection(COLLECTION).limit(500).get();
  carSnapshot = snapshot.docs.map((doc) => normalizeCar(doc.id, doc.data()));
  carSnapshotAt = Date.now();
  return carSnapshot;
}

function firstImage(data = {}) {
  const image =
    data.image_url ||
    data.imageUrl ||
    (Array.isArray(data.images) ? (typeof data.images[0] === 'string' ? data.images[0] : data.images[0]?.url) : '') ||
    '';
  return isBlobUrl(image) ? '' : image;
}

function normalizeCar(id, data = {}) {
  const make = data.make || data.brand || '';
  const price = data.price_per_day ?? data.pricePerDay ?? 0;
  const image = firstImage(data);
  const cityId =
    data.cityId ||
    (data.city ? String(data.city).toLowerCase().replace(/\s+/g, '-') : '');
  return {
    ...data,
    id,
    make,
    brand: data.brand || make,
    price_per_day: parseFloat(price) || 0,
    pricePerDay: parseFloat(price) || 0,
    image_url: image || '',
    images: Array.isArray(data.images)
      ? data.images.filter((img) => !isBlobUrl(typeof img === 'string' ? img : img?.url))
      : image
        ? [image]
        : [],
    cityId,
    placeId: data.placeId || null,
    geohash: data.geohash || '',
    createdAt: toIso(data.createdAt) || data.createdAt || '',
    updatedAt: toIso(data.updatedAt) || data.updatedAt || '',
  };
}

// Create new car listing
exports.createCar = async (req, res) => {
  try {
    const body = req.body || {};
    const brand = body.brand || body.make;
    const model = body.model;
    const year = body.year;
    const pricePerDay = body.pricePerDay ?? body.price_per_day;
    const fuel = body.fuel || body.fuelType || 'Petrol';
    const transmission = body.transmission || 'Automatic';
    const seats = body.seats || body.seatingCapacity || 5;
    const imageUrl = body.image_url || body.imageUrl || (body.images && body.images[0]) || '';
    if (isBlobUrl(imageUrl)) {
      return res.status(400).json({
        error: 'Photo could not be saved. Please choose the image again and resubmit.',
      });
    }
    const { resolved: geo } = await resolveCityFromBody(body, { requirePin: true });

    if (!brand || !model || !year || pricePerDay == null) {
      return res.status(400).json({
        error: 'Missing required fields: make/brand, model, year, price_per_day',
      });
    }
    if (!geo.cityId && !geo.city) {
      return res.status(400).json({ error: 'cityId or city is required' });
    }

    const userDoc = await db.collection(USERS_COLLECTION).doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Verify your driving licence before listing a car' });
    }
    const userData = userDoc.data() || {};
    if (!kycVerified({ ...userData, role: req.user.role || userData.role })) {
      return res.status(403).json({ error: 'Verify your driving licence before listing a car' });
    }

    const carData = {
      hostId: req.user.uid,
      hostName: userData.displayName || 'Host',
      hostPhotoURL: userData.photoURL || '',
      hostRating: userData.rating || 0,
      brand,
      make: brand,
      model,
      year: parseInt(year),
      category: body.category || 'Sedan',
      transmission,
      fuel,
      fuelType: fuel,
      seats: String(seats),
      seatingCapacity: parseInt(seats) || 5,
      pricePerDay: parseFloat(pricePerDay),
      price_per_day: parseFloat(pricePerDay),
      location: geo.location,
      address: geo.address,
      cityId: geo.cityId,
      city: geo.city,
      state: geo.state,
      placeId: geo.placeId,
      geohash: geo.geohash,
      description: body.description || '',
      image_url: imageUrl,
      images: imageUrl ? [imageUrl] : [],
      features: body.features || [],
      availability: [],
      rating: 4.5,
      totalReviews: 0,
      totalBookings: 0,
      available: true,
      isActive: true,
      views: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const carRef = await db.collection(COLLECTION).add(carData);
    invalidateCarSnapshot();

    try {
      await db.collection(USERS_COLLECTION).doc(req.user.uid).update({
        totalListings: admin.firestore.FieldValue.increment(1),
        role: 'both',
      });
    } catch (_) {
      /* ignore if user doc race */
    }

    res.status(201).json({
      success: true,
      message: 'Car listed successfully',
      carId: carRef.id,
      car: normalizeCar(carRef.id, carData),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get car by ID
exports.getCarById = async (req, res) => {
  try {
    const carDoc = await db.collection(COLLECTION).doc(req.params.carId).get();
    
    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const countView = req.query.view !== '0';
    if (countView) {
      await carDoc.ref.update({
        views: admin.firestore.FieldValue.increment(1)
      });
    }

    const carData = carDoc.data();
    const hostDoc = carData.hostId
      ? await db.collection(USERS_COLLECTION).doc(carData.hostId).get()
      : { exists: false };
    const hostData = hostDoc.exists ? hostDoc.data() : {};
    const isCatalog =
      carData.isPlatformListing === true ||
      hostData.role === 'admin' ||
      carData.hostId === 'SEED_USER_ADMIN';

    res.json({
      success: true,
      car: {
        ...normalizeCar(carDoc.id, carData),
        isPlatformListing: isCatalog,
        host: isCatalog
          ? {
              name: 'RentNHost',
              photoURL: carData.hostPhotoURL || '',
              rating: null,
              totalListings: null,
              isCatalog: true,
            }
          : {
              name: hostData.displayName || carData.hostName || 'Host',
              photoURL: hostData.photoURL || carData.hostPhotoURL || '',
              rating: hostData.rating || 0,
              totalListings: hostData.totalListings || 0,
              isCatalog: false,
            },
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Search cars with filters and pagination.
// Filters/sort run in memory so we don't need Firestore composite indexes for MVP.
exports.searchCars = async (req, res) => {
  try {
    const {
      city,
      cityId,
      state,
      category,
      minPrice,
      maxPrice,
      transmission,
      fuelType,
      seats,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    let cars = [...(await loadCarSnapshot())].filter(
      (car) => car.isActive !== false && car.available !== false
    );

    if (cityId) {
      const id = String(cityId).toLowerCase();
      cars = cars.filter((car) => {
        const carCityId =
          car.cityId ||
          (car.city ? String(car.city).toLowerCase().replace(/\s+/g, '-') : '');
        return carCityId === id || (car.city || '').toLowerCase() === id;
      });
    } else if (city) {
      const c = String(city).toLowerCase();
      const slug = c.replace(/\s+/g, '-');
      cars = cars.filter((car) => {
        const carCityId =
          car.cityId ||
          (car.city ? String(car.city).toLowerCase().replace(/\s+/g, '-') : '');
        return (car.city || '').toLowerCase() === c || carCityId === slug;
      });
    }
    if (state) {
      const s = String(state).toLowerCase();
      cars = cars.filter((car) => (car.state || '').toLowerCase() === s);
    }
    if (category) {
      cars = cars.filter((car) => car.category === category);
    }
    if (transmission) {
      cars = cars.filter((car) => car.transmission === transmission);
    }
    if (fuelType) {
      cars = cars.filter((car) => (car.fuel || car.fuelType) === fuelType);
    }
    if (seats) {
      const seatsNum = parseInt(seats, 10);
      if (!Number.isNaN(seatsNum)) {
        cars = cars.filter((car) => Number(car.seats || car.seatingCapacity) >= seatsNum);
      }
    }
    if (minPrice) {
      const min = parseFloat(minPrice);
      cars = cars.filter((car) => Number(car.price_per_day ?? car.pricePerDay) >= min);
    }
    if (maxPrice) {
      const max = parseFloat(maxPrice);
      cars = cars.filter((car) => Number(car.price_per_day ?? car.pricePerDay) <= max);
    }

    const validSortFields = ['pricePerDay', 'price_per_day', 'rating', 'createdAt', 'views'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const dir = sortOrder === 'asc' ? 1 : -1;
    cars.sort((a, b) => {
      const av = DATE_SORT_FIELDS.has(sortField)
        ? toMillis(a[sortField] || a.createdAt)
        : Number(a[sortField] ?? a.price_per_day ?? 0);
      const bv = DATE_SORT_FIELDS.has(sortField)
        ? toMillis(b[sortField] || b.createdAt)
        : Number(b[sortField] ?? b.price_per_day ?? 0);
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const totalResults = cars.length;
    const start = (pageNum - 1) * limitNum;
    const pageCars = cars.slice(start, start + limitNum);

    res.json({
      success: true,
      cars: pageCars,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalResults,
        totalPages: Math.ceil(totalResults / limitNum) || 0
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get nearby cars using geolocation
exports.getNearbyCars = async (req, res) => {
  try {
    const { lat, lng, radius = 50 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ 
        error: 'Latitude and longitude are required' 
      });
    }

    // Get all active cars (in production, use geohash for better performance)
    const snapshot = await db.collection(COLLECTION)
      .where('isActive', '==', true)
      .get();

    const cars = [];
    snapshot.docs.forEach(doc => {
      const car = doc.data();
      const carLat = car.location.latitude;
      const carLng = car.location.longitude;

      // Calculate distance using Haversine formula
      const distance = calculateDistance(
        parseFloat(lat),
        parseFloat(lng),
        carLat,
        carLng
      );

      if (distance <= parseFloat(radius)) {
        cars.push({
          ...normalizeCar(doc.id, car),
          distance: Math.round(distance * 10) / 10 // Round to 1 decimal
        });
      }
    });

    // Sort by distance
    cars.sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      cars,
      totalResults: cars.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Helper function: Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

// Update car listing
exports.updateCar = async (req, res) => {
  try {
    const { carId } = req.params;
    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const body = req.body || {};
    const updateData = { ...body };

    if (body.make || body.brand) {
      const brand = body.brand || body.make;
      updateData.brand = brand;
      updateData.make = brand;
    }
    if (body.pricePerDay != null || body.price_per_day != null) {
      const price = parseFloat(body.pricePerDay ?? body.price_per_day);
      updateData.pricePerDay = price;
      updateData.price_per_day = price;
    }
    if (body.image_url || body.imageUrl) {
      updateData.image_url = body.image_url || body.imageUrl;
    }

    if (body.cityId || body.city || body.location || body.address || body.placeId) {
      const { resolved: geo } = await resolveCityFromBody({
        cityId: body.cityId ?? carData.cityId,
        city: body.city ?? carData.city,
        state: body.state ?? carData.state,
        address: body.address ?? carData.address,
        placeId: body.placeId ?? carData.placeId,
        location: body.location || carData.location,
      });
      updateData.cityId = geo.cityId;
      updateData.city = geo.city;
      updateData.state = geo.state;
      updateData.address = geo.address;
      updateData.placeId = geo.placeId;
      updateData.location = geo.location;
      updateData.geohash = geo.geohash;
    }

    delete updateData.hostId;
    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection(COLLECTION).doc(carId).update(updateData);
    invalidateCarSnapshot();

    res.json({
      success: true,
      message: 'Car updated successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete car listing
exports.deleteCar = async (req, res) => {
  try {
    const { carId } = req.params;
    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check for active bookings
    const activeBookings = await db.collection('bookings')
      .where('carId', '==', carId)
      .where('status', 'in', ['pending', 'confirmed', 'ongoing'])
      .get();

    if (!activeBookings.empty) {
      return res.status(400).json({ 
        error: 'Cannot delete car with active bookings' 
      });
    }

    // Delete car images from storage
    if (carData.images && carData.images.length > 0) {
      for (const image of carData.images) {
        try {
          await deleteImage(image.fileName);
        } catch (err) {
          console.error('Error deleting image:', err);
        }
      }
    }

    // Delete car document
    await db.collection(COLLECTION).doc(carId).delete();
    invalidateCarSnapshot();

    // Update user's total listings count
    await db.collection(USERS_COLLECTION).doc(carData.hostId).update({
      totalListings: admin.firestore.FieldValue.increment(-1)
    });

    res.json({
      success: true,
      message: 'Car deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Upload car images
exports.uploadCarImages = async (req, res) => {
  try {
    const { carId } = req.params;
    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    // Upload images to Firebase Storage
    const uploadedImages = await uploadMultipleImages(
      req.files,
      `cars/${carId}`
    );

    // Update car document with new images
    const existingImages = carData.images || [];
    const newImages = [...existingImages, ...uploadedImages];

    await db.collection(COLLECTION).doc(carId).update({
      images: newImages,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Images uploaded successfully',
      images: uploadedImages
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete car image
exports.deleteCarImage = async (req, res) => {
  try {
    const { carId, imageId } = req.params;
    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const imageIndex = parseInt(imageId);
    if (isNaN(imageIndex) || imageIndex < 0 || imageIndex >= carData.images.length) {
      return res.status(400).json({ error: 'Invalid image index' });
    }

    // Delete from storage
    await deleteImage(carData.images[imageIndex].fileName);

    // Remove from array
    const updatedImages = carData.images.filter((_, idx) => idx !== imageIndex);

    await db.collection(COLLECTION).doc(carId).update({
      images: updatedImages,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Toggle car active status
exports.toggleCarStatus = async (req, res) => {
  try {
    const { carId } = req.params;
    const { isActive } = req.body;
    
    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const nextActive = isActive !== undefined ? Boolean(isActive) : carData.isActive === false;
    await db.collection(COLLECTION).doc(carId).update({
      isActive: nextActive,
      available: nextActive,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    invalidateCarSnapshot();

    res.json({
      success: true,
      isActive: nextActive,
      message: nextActive ? 'Car is listed' : 'Car is unlisted',
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get host's cars
exports.getHostCars = async (req, res) => {
  try {
    const snapshot = await db.collection(COLLECTION)
      .where('hostId', '==', req.user.uid)
      .get();

    const cars = snapshot.docs
      .map((doc) => normalizeCar(doc.id, doc.data()))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    res.json({
      success: true,
      cars,
      totalCars: cars.length,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Check car availability for specific dates
exports.checkAvailability = async (req, res) => {
  try {
    const { carId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Start date and end date are required' 
      });
    }

    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    // Check for conflicting bookings
    const bookingsSnapshot = await db.collection('bookings')
      .where('carId', '==', carId)
      .where('status', 'in', ['confirmed', 'ongoing'])
      .get();

    const requestedStart = new Date(startDate);
    const requestedEnd = new Date(endDate);
    let isAvailable = true;

    bookingsSnapshot.docs.forEach(doc => {
      const booking = doc.data();
      const bookingStart = booking.startDate.toDate();
      const bookingEnd = booking.endDate.toDate();

      // Check for date overlap
      if (requestedStart <= bookingEnd && requestedEnd >= bookingStart) {
        isAvailable = false;
      }
    });

    res.json({
      success: true,
      available: isAvailable,
      carId,
      requestedDates: {
        startDate,
        endDate
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Get car reviews
exports.getCarReviews = async (req, res) => {
  try {
    const { carId } = req.params;
    const snapshot = await db.collection('reviews').where('carId', '==', carId).limit(80).get();
    const reviews = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          createdAt: toIso(d.createdAt) || d.createdAt || '',
        };
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({ success: true, reviews, totalReviews: reviews.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.createReview = async (req, res) => {
  try {
    const { carId } = req.params;
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim();
    const bookingId = String(req.body?.bookingId || '').trim();
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be 1–5' });
    }

    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });
    const booking = bookingDoc.data();
    if (booking.renterId !== req.user.uid) return res.status(403).json({ error: 'Not authorized' });
    if (booking.carId !== carId) return res.status(400).json({ error: 'Booking does not match this car' });
    if (booking.paymentStatus !== 'paid') {
      return res.status(400).json({ error: 'You can review after payment' });
    }

    const existing = await db.collection('reviews').where('bookingId', '==', bookingId).limit(1).get();
    if (!existing.empty) return res.status(400).json({ error: 'You already reviewed this trip' });

    const carDoc = await db.collection(COLLECTION).doc(carId).get();
    if (!carDoc.exists) return res.status(404).json({ error: 'Car not found' });
    const car = carDoc.data();

    let renterName = req.user.email?.split('@')[0] || 'Guest';
    const userDoc = await db.collection(USERS_COLLECTION).doc(req.user.uid).get();
    if (userDoc.exists) renterName = userDoc.data().displayName || renterName;

    const review = {
      carId,
      bookingId,
      renterId: req.user.uid,
      renterName,
      rating: Math.round(rating),
      comment,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('reviews').add(review);

    const all = await db.collection('reviews').where('carId', '==', carId).get();
    const ratings = all.docs.map((d) => Number(d.data().rating) || 0);
    const avg = ratings.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : rating;
    await carDoc.ref.update({
      rating: Math.round(avg * 10) / 10,
      totalReviews: ratings.length,
    });
    invalidateCarSnapshot();

    res.status(201).json({
      success: true,
      review: { id: ref.id, ...review, hostId: car.hostId },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Update car availability
exports.updateAvailability = async (req, res) => {
  try {
    const { carId } = req.params;
    const { availability } = req.body;

    const carDoc = await db.collection(COLLECTION).doc(carId).get();

    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const carData = carDoc.data();

    // Verify ownership
    if (carData.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.collection(COLLECTION).doc(carId).update({
      availability: availability || [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: 'Availability updated successfully'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = exports;