/** Structured source assertions whose members are inseparable under review.
 * This list is intentionally narrow: topology objects and independently
 * evidenced dimensions retain their existing leaf-approval behavior.
 */
export const atomicProductFields = new Set([
  // Cross-field participants and evidence ownership cannot survive leaf approval.
  // Source-adjudicated members compose a single replay-validated profile. Product
  // approval remains a separate human operation over the complete root value.
  'engineering_profile',
  'battery.allowed_series_count',
  'battery.charging_voltage_range_v',
  'battery.float_voltage_range_v',
]);
