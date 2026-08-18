const { db } = require('../config/firebaseAdmin');
const { PLATFORM_FEE_RATE, resolveSplit, countsTowardRevenue } = require('../utils/platformFee');

const CAR_COLLECTION = 'car';

function toIso(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeBooking(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    ...d,
    startDate: toIso(d.startDate),
    endDate: toIso(d.endDate),
    createdAt: toIso(d.createdAt),
    confirmedAt: toIso(d.confirmedAt),
    cancelledAt: toIso(d.cancelledAt),
  };
}

exports.getStats = async (req, res) => {
  try {
    const uid = req.user.uid;
    const now = new Date();

    const [carsSnap, hostBookingsSnap, renterBookingsSnap] = await Promise.all([
      db.collection(CAR_COLLECTION).where('hostId', '==', uid).get(),
      db.collection('bookings').where('hostId', '==', uid).get(),
      db.collection('bookings').where('renterId', '==', uid).get(),
    ]);

    const listings = carsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const hostBookings = hostBookingsSnap.docs.map(normalizeBooking);
    const renterBookings = renterBookingsSnap.docs.map(normalizeBooking);

    const activeListings = listings.filter((c) => c.isActive !== false && c.available !== false).length;
    const totalViews = listings.reduce((sum, c) => sum + (Number(c.views) || 0), 0);

    const isActiveStatus = (b) => ['confirmed', 'ongoing', 'pending'].includes(b.status);
    const activeHostBookings = hostBookings.filter(isActiveStatus);
    const upcomingHost = hostBookings.filter((b) => {
      if (!isActiveStatus(b) || !b.startDate) return false;
      return new Date(b.startDate) >= now;
    });
    const cancelledHost = hostBookings.filter((b) => b.status === 'cancelled');
    const estimatedEarnings = hostBookings
      .filter(countsTowardRevenue)
      .reduce((sum, b) => sum + resolveSplit(b).hostPayout, 0);

    res.json({
      success: true,
      stats: {
        listings: {
          total: listings.length,
          active: activeListings,
          views: totalViews,
        },
        host: {
          bookingsTotal: hostBookings.length,
          bookingsActive: activeHostBookings.length,
          bookingsUpcoming: upcomingHost.length,
          bookingsCancelled: cancelledHost.length,
          estimatedEarnings,
          feeRate: PLATFORM_FEE_RATE,
        },
        renter: {
          bookingsTotal: renterBookings.length,
          bookingsActive: renterBookings.filter(isActiveStatus).length,
        },
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

function carImage(car) {
  const raw = car.image_url || (typeof car.images?.[0] === 'string' ? car.images[0] : car.images?.[0]?.url) || '';
  return raw.startsWith('blob:') ? '' : raw;
}

exports.getAdminOverview = async (req, res) => {
  try {
    const adminUid = req.user.uid;
    const [usersSnap, carsSnap, bookingsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection(CAR_COLLECTION).get(),
      db.collection('bookings').get(),
    ]);

    const users = usersSnap.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    const cars = carsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const bookings = bookingsSnap.docs.map(normalizeBooking);

    const isCatalog = (car) =>
      car.hostId === adminUid || car.hostId === 'SEED_USER_ADMIN' || car.isPlatformListing === true;
    const catalogCars = cars.filter(isCatalog);
    const communityCars = cars.filter((car) => !isCatalog(car));

    const usersById = Object.fromEntries(users.map((u) => [u.uid, u]));
    const hostIds = [...new Set(communityCars.map((c) => c.hostId).filter(Boolean))];
    const paid = bookings.filter(countsTowardRevenue);
    let catalogRevenue = 0;
    let commission = 0;
    let hostPayouts = 0;
    paid.forEach((b) => {
      const split = resolveSplit(b, { adminUid });
      if (split.isCatalog) catalogRevenue += split.platformFee;
      else {
        commission += split.platformFee;
        hostPayouts += split.hostPayout;
      }
    });
    const gmv = paid.reduce((sum, b) => sum + (Number(b.totalPrice) || 0), 0);

    const hosts = hostIds
      .map((uid) => {
        const profile = usersById[uid] || {};
        const listings = communityCars.filter((c) => c.hostId === uid);
        const hostBookings = bookings.filter((b) => b.hostId === uid);
        const paidHost = hostBookings.filter(countsTowardRevenue);
        return {
          uid,
          displayName: profile.displayName || listings[0]?.hostName || 'Host',
          email: profile.email || '',
          photoURL: profile.photoURL || listings[0]?.hostPhotoURL || '',
          listings: listings.length,
          activeListings: listings.filter((c) => c.isActive !== false && c.available !== false).length,
          views: listings.reduce((sum, c) => sum + (Number(c.views) || 0), 0),
          bookings: hostBookings.length,
          commission: paidHost.reduce((sum, b) => sum + resolveSplit(b, { adminUid }).platformFee, 0),
          payout: paidHost.reduce((sum, b) => sum + resolveSplit(b, { adminUid }).hostPayout, 0),
        };
      })
      .sort((a, b) => b.listings - a.listings);

    const isActiveBooking = (b) => ['confirmed', 'ongoing', 'pending'].includes(b.status);

    const recentBookings = [...bookings]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 12)
      .map((b) => {
        const split = resolveSplit(b, { adminUid });
        return {
          id: b.id,
          title: `${b.carMake || ''} ${b.carModel || ''}`.trim() || 'Booking',
          status: b.status,
          totalPrice: b.totalPrice,
          platformFee: split.platformFee,
          hostPayout: split.hostPayout,
          startDate: b.startDate,
          createdAt: b.createdAt,
          renterName: b.renterName || b.renterEmail || 'Guest',
          hostId: b.hostId,
          isCatalog: split.isCatalog,
        };
      });

    res.json({
      success: true,
      stats: {
        hosts: hosts.length,
        users: users.filter((u) => u.role !== 'admin').length,
        catalogListings: catalogCars.length,
        communityListings: communityCars.length,
        listingsActive: cars.filter((c) => c.isActive !== false && c.available !== false).length,
        bookingsTotal: bookings.length,
        bookingsActive: bookings.filter(isActiveBooking).length,
        gmv,
        catalogRevenue,
        commission,
        hostPayouts,
        platformRevenue: catalogRevenue + commission,
        feeRate: PLATFORM_FEE_RATE,
      },
      hosts,
      catalog: catalogCars.map((c) => ({
        id: c.id,
        make: c.make || c.brand || 'Car',
        model: c.model || '',
        year: c.year || '',
        city: c.city || c.address || '',
        category: c.category || '',
        pricePerDay: c.price_per_day ?? c.pricePerDay ?? 0,
        isActive: c.isActive !== false && c.available !== false,
        views: Number(c.views) || 0,
        image: carImage(c),
      })),
      recentBookings,
      kycQueue: users
        .filter(
          (u) =>
            u.role !== 'admin' &&
            (u.kycStatus === 'rejected' ||
              (u.kycStatus === 'pending' && (u.licenceNumber || u.licenceImage)))
        )
        .map((u) => ({
          uid: u.uid,
          displayName: u.displayName || '',
          email: u.email || '',
          licenceNumber: u.licenceNumber || '',
          licenceImage: u.licenceImage || '',
          kycStatus: u.kycStatus,
          kycRejectReason: u.kycRejectReason || '',
        })),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getActivity = async (req, res) => {
  try {
    const uid = req.user.uid;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const [hostSnap, renterSnap] = await Promise.all([
      db.collection('bookings').where('hostId', '==', uid).get(),
      db.collection('bookings').where('renterId', '==', uid).get(),
    ]);

    const seen = new Set();
    const activity = [];

    [...hostSnap.docs, ...renterSnap.docs].forEach((doc) => {
      if (seen.has(doc.id)) return;
      seen.add(doc.id);
      const booking = normalizeBooking(doc);
      const role = booking.hostId === uid ? 'host' : 'renter';
      activity.push({
        id: booking.id,
        type: 'booking',
        role,
        status: booking.status,
        title: `${booking.carMake || ''} ${booking.carModel || ''}`.trim() || 'Booking',
        totalPrice: booking.totalPrice,
        hostPayout: booking.hostPayout,
        platformFee: booking.platformFee,
        startDate: booking.startDate,
        endDate: booking.endDate,
        createdAt: booking.createdAt,
      });
    });

    activity.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    res.json({
      success: true,
      activity: activity.slice(0, limit),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
