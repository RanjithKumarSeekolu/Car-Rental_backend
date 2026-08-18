const { db, admin } = require('../config/firebaseAdmin');
const { isCatalogListing, splitFare, resolveSplit } = require('../utils/platformFee');
const { kycVerified } = require('../utils/kyc');

const CAR_COLLECTION = 'car';

function normalizeBooking(doc) {
  const d = doc.data();
  const booking = {
    id: doc.id,
    ...d,
    startDate: d.startDate?.toDate?.()?.toISOString?.() || d.startDate,
    endDate: d.endDate?.toDate?.()?.toISOString?.() || d.endDate,
    createdAt: d.createdAt?.toDate?.()?.toISOString?.() || d.createdAt,
    confirmedAt: d.confirmedAt?.toDate?.()?.toISOString?.() || d.confirmedAt,
    cancelledAt: d.cancelledAt?.toDate?.()?.toISOString?.() || d.cancelledAt,
  };
  return { ...booking, ...resolveSplit(booking) };
}

/** Returns true if [s1,e1) overlaps [s2,e2) */
function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && e1 > s2;
}

/** Fetch all active (non-cancelled) bookings for a car and return their date ranges. */
async function getBookedRanges(carId) {
  const snap = await db
    .collection('bookings')
    .where('carId', '==', carId)
    .where('status', 'in', ['pending', 'confirmed', 'ongoing'])
    .get();

  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      start: d.startDate?.toDate?.() || new Date(d.startDate),
      end: d.endDate?.toDate?.() || new Date(d.endDate),
    };
  });
}

exports.createBooking = async (req, res) => {
  try {
    const { carId, startDate, endDate, pickupLocation, dropLocation } = req.body;

    if (!carId || !startDate || !endDate) {
      return res.status(400).json({ error: 'carId, startDate, and endDate are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (days < 1) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const renterDoc = await db.collection('users').doc(req.user.uid).get();
    if (!renterDoc.exists) {
      return res.status(403).json({ error: 'Verify your driving licence before booking' });
    }
    const renterProfile = renterDoc.data() || {};
    if (!kycVerified({ ...renterProfile, role: req.user.role || renterProfile.role })) {
      return res.status(403).json({ error: 'Verify your driving licence before booking' });
    }

    const carDoc = await db.collection(CAR_COLLECTION).doc(carId).get();
    if (!carDoc.exists) {
      return res.status(404).json({ error: 'Car not found' });
    }

    const car = carDoc.data();
    if (car.isActive === false || car.available === false) {
      return res.status(400).json({ error: 'This car is not listed right now' });
    }

    // Overlap check — reject if dates clash with any active booking
    const bookedRanges = await getBookedRanges(carId);
    const conflict = bookedRanges.find((r) => overlaps(start, end, r.start, r.end));
    if (conflict) {
      return res.status(409).json({
        error: 'Car is already booked for those dates. Please choose different dates.',
        conflictStart: conflict.start.toISOString(),
        conflictEnd: conflict.end.toISOString(),
      });
    }
    const pricePerDay = parseFloat(car.pricePerDay || car.price_per_day || 0);
    const totalPrice = days * pricePerDay;
    const fare = splitFare(totalPrice, isCatalogListing(car));

    let renterName = req.user.email?.split('@')[0] || 'Guest';
    let renterPhotoURL = '';
    let renterPhone = '';
    try {
      const userDoc = await db.collection('users').doc(req.user.uid).get();
      if (userDoc.exists) {
        const u = userDoc.data() || {};
        renterName = u.displayName || renterName;
        renterPhotoURL = u.photoURL || '';
        renterPhone = u.phoneNumber || '';
      }
    } catch (_) {
      /* profile optional */
    }

    const bookingData = {
      carId,
      carMake: car.make || car.brand || '',
      carModel: car.model || '',
      carImage: car.image_url || (car.images && car.images[0]) || '',
      renterId: req.user.uid,
      renterEmail: req.user.email || '',
      renterName,
      renterPhotoURL,
      renterPhone,
      hostId: car.hostId || 'SEED_USER_ADMIN',
      startDate: admin.firestore.Timestamp.fromDate(start),
      endDate: admin.firestore.Timestamp.fromDate(end),
      days,
      totalPrice,
      isCatalog: fare.isCatalog,
      platformFeeRate: fare.platformFeeRate,
      platformFee: fare.platformFee,
      hostPayout: fare.hostPayout,
      status: 'pending',
      paymentStatus: 'unpaid',
      pickupLocation:
        typeof pickupLocation === 'string'
          ? pickupLocation
          : pickupLocation?.name || car.city || '',
      dropLocation:
        typeof dropLocation === 'string'
          ? dropLocation
          : dropLocation?.name || car.city || '',
      cityId: car.cityId || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const bookingRef = await db.collection('bookings').add(bookingData);

    res.status(201).json({
      success: true,
      message: 'Booking created',
      bookingId: bookingRef.id,
      totalPrice,
      platformFee: fare.platformFee,
      hostPayout: fare.hostPayout,
      booking: {
        id: bookingRef.id,
        ...bookingData,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

function publicRenter(booking, user = {}) {
  return {
    displayName: booking.renterName || user.displayName || (booking.renterEmail || '').split('@')[0] || 'Guest',
    email: booking.renterEmail || user.email || '',
    photoURL: booking.renterPhotoURL || user.photoURL || '',
    phoneNumber: booking.renterPhone || user.phoneNumber || '',
  };
}

async function attachRenters(bookings) {
  const ids = [...new Set(bookings.map((b) => b.renterId).filter(Boolean))];
  const snaps = await Promise.all(ids.map((id) => db.collection('users').doc(id).get()));
  const users = {};
  snaps.forEach((snap) => {
    if (snap.exists) users[snap.id] = snap.data() || {};
  });
  return bookings.map((booking) => ({
    ...booking,
    renter: publicRenter(booking, users[booking.renterId] || {}),
  }));
}

async function attachHosts(bookings) {
  const paid = new Set(
    bookings.filter((b) => b.paymentStatus === 'paid').map((b) => b.hostId).filter(Boolean)
  );
  if (!paid.size) return bookings;
  const snaps = await Promise.all([...paid].map((id) => db.collection('users').doc(id).get()));
  const hosts = {};
  snaps.forEach((snap) => {
    if (snap.exists) hosts[snap.id] = snap.data() || {};
  });
  return bookings.map((booking) => {
    if (booking.paymentStatus !== 'paid' || !booking.hostId) return booking;
    const h = hosts[booking.hostId] || {};
    return {
      ...booking,
      host: {
        name: h.displayName || booking.hostName || 'Host',
        photoURL: h.photoURL || booking.hostPhotoURL || '',
        phone: h.phoneNumber || '',
        email: h.email || '',
      },
    };
  });
}

exports.getMyBookings = async (req, res) => {
  try {
    const asHost = req.query.as === 'host';
    const field = asHost ? 'hostId' : 'renterId';

    const snapshot = await db.collection('bookings').where(field, '==', req.user.uid).get();

    let bookings = snapshot.docs
      .map(normalizeBooking)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (asHost) {
      bookings = await attachRenters(bookings);
    } else {
      bookings = await attachHosts(bookings);
    }

    res.json({ success: true, bookings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = normalizeBooking(bookingDoc);
    if (booking.renterId !== req.user.uid && booking.hostId !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ success: true, booking });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.confirmBooking = async (_req, res) => {
  res.status(400).json({ error: 'Complete Razorpay checkout to confirm this booking' });
};

/** Public endpoint: returns booked date ranges for a car so the frontend can block unavailable dates. */
exports.getBookedDates = async (req, res) => {
  try {
    const { carId } = req.params;
    const ranges = await getBookedRanges(carId);
    res.json({
      success: true,
      booked: ranges.map((r) => ({
        start: r.start.toISOString().slice(0, 10),
        end: r.end.toISOString().slice(0, 10),
      })),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body || {};

    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingDoc.data();
    if (booking.renterId !== req.user.uid && booking.hostId !== req.user.uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await db.collection('bookings').doc(bookingId).update({
      status: 'cancelled',
      cancellationReason: reason || '',
      cancelledBy: req.user.uid,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: 'Booking cancelled' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
