// Standard ASTM B258 American Wire Gauge (AWG) calculations and discrete size definitions.
// Conductor size normalizes deterministically to cross-sectional area in mm².
// Ampacity is NEVER inferred from AWG or area alone (ampacity depends on installation, standard, insulation, and ambient conditions).

export interface AwgSizeInfo {
  readonly gauge: string;
  readonly gaugeIndex: number;
  readonly areaMm2: number;
  readonly diameterMm: number;
}

// Standard AWG gauges from 4/0 down to 40 AWG
// 4/0 = -3, 3/0 = -2, 2/0 = -1, 1/0 = 0, 1..40 = 1..40
export const STANDARD_AWG_GAUGES: readonly string[] = [
  '4/0',
  '3/0',
  '2/0',
  '1/0',
  ...Array.from({ length: 40 }, (_, i) => String(i + 1)),
];

export const parseAwgGaugeIndex = (raw: string | number): number | undefined => {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) return undefined;
    if (raw >= -3 && raw <= 40) return raw;
    return undefined;
  }
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .trim()
    .replace(/\s*(?:awg|american wire gauge)$/i, '')
    .trim();

  // Handle slash notation
  if (cleaned === '4/0') return -3;
  if (cleaned === '3/0') return -2;
  if (cleaned === '2/0') return -1;
  if (cleaned === '1/0' || cleaned === '0/0') return 0;

  // Handle leading zero notation
  if (cleaned === '0000') return -3;
  if (cleaned === '000') return -2;
  if (cleaned === '00') return -1;
  if (cleaned === '0') return 0;

  // Integer gauges
  if (/^\d+$/.test(cleaned)) {
    const num = Number(cleaned);
    if (num >= 1 && num <= 40) return num;
  }

  return undefined;
};

export const formatAwg = (gaugeIndex: number): string => {
  if (gaugeIndex === -3) return '4/0';
  if (gaugeIndex === -2) return '3/0';
  if (gaugeIndex === -1) return '2/0';
  if (gaugeIndex === 0) return '1/0';
  return String(gaugeIndex);
};

// ASTM B258 formula:
// Single solid round conductor diameter in inches: d_n = 0.005 * 92^((36 - n) / 39) in
// In millimeters: d_n = 0.127 * 92^((36 - n) / 39) mm
// Cross-sectional area: A_n = (pi / 4) * d_n^2 mm²
export const awgIndexToDiameterMm = (gaugeIndex: number): number =>
  0.127 * Math.pow(92, (36 - gaugeIndex) / 39);

export const awgIndexToAreaMm2 = (gaugeIndex: number): number => {
  const d = awgIndexToDiameterMm(gaugeIndex);
  return (Math.PI / 4) * d * d;
};

export const awgToAreaMm2 = (gauge: string | number): number | undefined => {
  const index = parseAwgGaugeIndex(gauge);
  if (index === undefined) return undefined;
  return awgIndexToAreaMm2(index);
};

export const parseAwg = (raw: string | number): AwgSizeInfo | undefined => {
  const index = parseAwgGaugeIndex(raw);
  if (index === undefined) return undefined;
  return {
    gauge: formatAwg(index),
    gaugeIndex: index,
    areaMm2: awgIndexToAreaMm2(index),
    diameterMm: awgIndexToDiameterMm(index),
  };
};

export const isStandardAwg = (raw: string | number): boolean => {
  const index = parseAwgGaugeIndex(raw);
  if (index === undefined) return false;
  return STANDARD_AWG_GAUGES.includes(formatAwg(index));
};

export const areaMm2ToNearestAwg = (areaMm2: number): string | undefined => {
  if (!Number.isFinite(areaMm2) || areaMm2 <= 0) return undefined;
  const d = Math.sqrt((4 * areaMm2) / Math.PI);
  // d / 0.127 = 92^((36 - n) / 39) => (36 - n) / 39 = ln(d / 0.127) / ln(92)
  const n = 36 - 39 * (Math.log(d / 0.127) / Math.log(92));
  const rounded = Math.round(n);
  if (rounded < -3 || rounded > 40) return undefined;
  const candidate = formatAwg(rounded);
  return isStandardAwg(candidate) ? candidate : undefined;
};
