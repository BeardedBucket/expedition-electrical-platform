/** Structured source assertions whose members are inseparable under review.
 * This list is intentionally narrow: topology objects and independently
 * evidenced dimensions retain their existing leaf-approval behavior.
 */
export const atomicProductFields = new Set([
  'battery.allowed_series_count',
  'battery.charging_voltage_range_v',
  'battery.float_voltage_range_v',
]);
