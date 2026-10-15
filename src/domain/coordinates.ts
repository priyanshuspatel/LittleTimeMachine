/**
 * Formats a WGS84 coordinate pair with the hemisphere that matches the sign.
 *
 * @param latitude - Decimal degrees from -90 through 90.
 * @param longitude - Decimal degrees from -180 through 180.
 * @returns A short label such as `23.030°N, 72.570°E`.
 * @throws {Error} When a value is not finite or is outside the valid range.
 */
export function formatCoordinates(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Coordinates must be finite numbers");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("Coordinates are out of range");
  }
  const latitudeHemisphere = latitude >= 0 ? "N" : "S";
  const longitudeHemisphere = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(3)}°${latitudeHemisphere}, ${Math.abs(longitude).toFixed(3)}°${longitudeHemisphere}`;
}
