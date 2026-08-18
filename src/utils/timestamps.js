/** Normalize Firestore timestamps, ISO strings, and { _seconds } payloads to millis / ISO. */

function toMillis(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const seconds = value._seconds ?? value.seconds;
  if (typeof seconds === 'number') {
    const nanos = value._nanoseconds ?? value.nanoseconds ?? 0;
    return seconds * 1000 + Math.floor(nanos / 1e6);
  }
  return 0;
}

function toIso(value) {
  const ms = toMillis(value);
  return ms ? new Date(ms).toISOString() : '';
}

function isBlobUrl(url) {
  return typeof url === 'string' && url.startsWith('blob:');
}

module.exports = { toMillis, toIso, isBlobUrl };
