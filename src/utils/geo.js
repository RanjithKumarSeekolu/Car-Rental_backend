const EARTH_KM = 6371;
const MAX_KM_FROM_CITY = 80;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

function inIndia(lat, lng) {
  return lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;
}

module.exports = { haversineKm, inIndia, MAX_KM_FROM_CITY };
