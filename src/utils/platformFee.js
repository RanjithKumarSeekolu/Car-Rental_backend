const PLATFORM_FEE_RATE = Number(process.env.PLATFORM_FEE_RATE) || 0.15;

function isCatalogListing(car = {}, adminUid) {
  return (
    car.isPlatformListing === true ||
    car.hostId === 'SEED_USER_ADMIN' ||
    (adminUid && car.hostId === adminUid)
  );
}

function splitFare(totalPrice, isCatalog) {
  const total = Math.round(Number(totalPrice) || 0);
  if (isCatalog) {
    return {
      isCatalog: true,
      platformFeeRate: 1,
      platformFee: total,
      hostPayout: 0,
    };
  }
  const platformFee = Math.round(total * PLATFORM_FEE_RATE);
  return {
    isCatalog: false,
    platformFeeRate: PLATFORM_FEE_RATE,
    platformFee,
    hostPayout: total - platformFee,
  };
}

function resolveSplit(booking = {}, { adminUid } = {}) {
  if (booking.platformFee != null && booking.hostPayout != null) {
    return {
      isCatalog: !!booking.isCatalog,
      platformFeeRate: Number(booking.platformFeeRate) || (booking.isCatalog ? 1 : PLATFORM_FEE_RATE),
      platformFee: Number(booking.platformFee) || 0,
      hostPayout: Number(booking.hostPayout) || 0,
    };
  }
  const isCatalog =
    booking.isCatalog === true ||
    booking.hostId === 'SEED_USER_ADMIN' ||
    (adminUid && booking.hostId === adminUid);
  return splitFare(booking.totalPrice, isCatalog);
}

function countsTowardRevenue(booking) {
  return ['confirmed', 'ongoing', 'completed'].includes(booking.status);
}

module.exports = {
  PLATFORM_FEE_RATE,
  isCatalogListing,
  splitFare,
  resolveSplit,
  countsTowardRevenue,
};
