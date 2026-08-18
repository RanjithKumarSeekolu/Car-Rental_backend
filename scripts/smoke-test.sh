#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

echo "Smoke testing $BASE_URL ..."

health="$(curl -sS -f "$BASE_URL/health" || true)"
echo "$health" | grep -q '"ok":true' || fail "health check failed (got: $health)"

cars="$(curl -sS -f "$BASE_URL/api/cars?limit=1" || true)"
echo "$cars" | grep -q '"success":true' || fail "cars list failed (got: $cars)"
echo "$cars" | grep -q '"cars"' || fail "cars list missing cars array"

locations="$(curl -sS -f "$BASE_URL/api/locations" || true)"
echo "$locations" | grep -q '"success":true' || fail "locations failed (got: $locations)"
echo "$locations" | grep -q '"center"' || fail "locations missing center (maps-ready)"

city="$(curl -sS -f "$BASE_URL/api/cars?cityId=hyderabad&limit=1" || true)"
echo "$city" | grep -q '"success":true' || fail "cityId filter failed (got: $city)"

echo "SMOKE OK"
exit 0
