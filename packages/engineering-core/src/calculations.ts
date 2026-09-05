import type {
  CalculationResult,
  ConductorInput,
  ConductorResult,
  ConversionCurrentPowerInput,
  ConversionCurrentPowerResult,
  ConversionPowerCurrentInput,
  ConversionPowerCurrentResult,
  DirectCurrentPowerInput,
  DirectCurrentPowerResult,
  DirectPowerCurrentInput,
  DirectPowerCurrentResult,
  RoundTripLengthInput,
  SystemVoltageComparisonInput,
  VoltageCandidate,
  VoltageCandidateComparison,
  WireCandidate,
  WireCandidateEvaluation,
  WireConstraints,
} from './contracts.js';

const success = <T>(value: T, warnings: readonly string[] = []): CalculationResult<T> => ({
  ok: true,
  value,
  warnings,
});

const failure = (
  code: 'invalid_input' | 'insufficient_data',
  reasons: readonly string[],
): CalculationResult<never> => ({ ok: false, code, reasons, warnings: [] });

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const validEfficiency = (efficiency: number): boolean =>
  Number.isFinite(efficiency) && efficiency > 0 && efficiency <= 1;

export const directPowerToCurrent = (
  input: DirectPowerCurrentInput,
): CalculationResult<DirectPowerCurrentResult> => {
  if (!finiteNonNegative(input.powerW) || !finitePositive(input.voltageV)) {
    return failure('invalid_input', ['powerW must be non-negative and voltageV must be positive.']);
  }
  return success({ currentA: input.powerW / input.voltageV, ...input });
};

export const directCurrentToPower = (
  input: DirectCurrentPowerInput,
): CalculationResult<DirectCurrentPowerResult> => {
  if (!finiteNonNegative(input.currentA) || !finitePositive(input.voltageV)) {
    return failure('invalid_input', [
      'currentA must be non-negative and voltageV must be positive.',
    ]);
  }
  return success({ powerW: input.currentA * input.voltageV, ...input });
};

export const conversionPowerToCurrent = (
  input: ConversionPowerCurrentInput,
): CalculationResult<ConversionPowerCurrentResult> => {
  if (!finiteNonNegative(input.powerW) || !finitePositive(input.voltageV)) {
    return failure('invalid_input', ['powerW must be non-negative and voltageV must be positive.']);
  }
  if (!validEfficiency(input.efficiency)) {
    return failure('invalid_input', [
      'Conversion efficiency must be greater than 0 and no greater than 1.',
    ]);
  }
  const inputPowerW = input.powerW / input.efficiency;
  return success({
    currentA: inputPowerW / input.voltageV,
    inputPowerW,
    outputPowerW: input.powerW,
    voltageV: input.voltageV,
    efficiency: input.efficiency,
  });
};

export const conversionCurrentToPower = (
  input: ConversionCurrentPowerInput,
): CalculationResult<ConversionCurrentPowerResult> => {
  if (!finiteNonNegative(input.currentA) || !finitePositive(input.voltageV)) {
    return failure('invalid_input', [
      'currentA must be non-negative and voltageV must be positive.',
    ]);
  }
  if (!validEfficiency(input.efficiency)) {
    return failure('invalid_input', [
      'Conversion efficiency must be greater than 0 and no greater than 1.',
    ]);
  }
  const inputPowerW = input.currentA * input.voltageV;
  return success({
    inputPowerW,
    outputPowerW: inputPowerW * input.efficiency,
    currentA: input.currentA,
    voltageV: input.voltageV,
    efficiency: input.efficiency,
  });
};

export const roundTripLength = (input: RoundTripLengthInput): CalculationResult<number> => {
  if (!Number.isFinite(input.oneWayLengthM) || input.oneWayLengthM < 0) {
    return failure('invalid_input', ['oneWayLengthM must be finite and non-negative.']);
  }
  return success(input.roundTrip === false ? input.oneWayLengthM : input.oneWayLengthM * 2);
};

export const calculateConductor = (input: ConductorInput): CalculationResult<ConductorResult> => {
  if (
    !finiteNonNegative(input.currentA) ||
    !finitePositive(input.nominalVoltageV) ||
    !finiteNonNegative(input.resistanceOhmPerM)
  ) {
    return failure('invalid_input', [
      'currentA and resistanceOhmPerM must be non-negative; nominalVoltageV must be positive.',
    ]);
  }
  const length = roundTripLength({
    oneWayLengthM: input.oneWayLengthM,
    roundTrip: input.roundTrip,
  });
  if (!length.ok) return length;
  const resistanceOhm = length.value * input.resistanceOhmPerM;
  const voltageDropV = input.currentA * resistanceOhm;
  return success({
    effectiveLengthM: length.value,
    resistanceOhm,
    voltageDropV,
    powerLossW: input.currentA * input.currentA * resistanceOhm,
    percentVoltageDrop: (voltageDropV / input.nominalVoltageV) * 100,
  });
};

export const percentVoltageDrop = (
  voltageDropV: number,
  nominalVoltageV: number,
): CalculationResult<number> => {
  if (!finiteNonNegative(voltageDropV) || !finitePositive(nominalVoltageV)) {
    return failure('invalid_input', [
      'voltageDropV must be non-negative and nominalVoltageV must be positive.',
    ]);
  }
  return success((voltageDropV / nominalVoltageV) * 100);
};

export const compareSystemVoltageCandidates = (
  input: SystemVoltageComparisonInput,
  candidates: readonly VoltageCandidate[],
): CalculationResult<readonly VoltageCandidateComparison[]> => {
  if (!finiteNonNegative(input.powerW)) {
    return failure('invalid_input', ['powerW must be non-negative.']);
  }
  if (input.powerBasis === 'converted-load' && input.conversionEfficiency === undefined) {
    return failure('insufficient_data', [
      'A conversionEfficiency is required when comparing a converted load power.',
    ]);
  }
  if (input.conversionEfficiency !== undefined && !validEfficiency(input.conversionEfficiency)) {
    return failure('invalid_input', [
      'conversionEfficiency must be greater than 0 and no greater than 1.',
    ]);
  }
  if (candidates.length === 0) {
    return failure('insufficient_data', ['No system-voltage candidates were provided.']);
  }
  if (candidates.some((candidate) => !finitePositive(candidate.voltageV))) {
    return failure('invalid_input', ['Every candidate voltageV must be finite and positive.']);
  }
  const sourcePowerW =
    input.powerBasis === 'converted-load'
      ? input.powerW / (input.conversionEfficiency as number)
      : input.powerW;
  return success(
    candidates.map((candidate) => ({
      ...candidate,
      sourcePowerW,
      currentA: sourcePowerW / candidate.voltageV,
    })),
  );
};

export const evaluateWireCandidate = (
  candidate: WireCandidate,
  constraints: WireConstraints,
  ampacityA?: number,
): CalculationResult<WireCandidateEvaluation> => {
  if (!finiteNonNegative(constraints.currentA) || !finitePositive(constraints.systemVoltageV)) {
    return failure('invalid_input', [
      'currentA must be non-negative and systemVoltageV must be positive.',
    ]);
  }
  if (!Number.isFinite(constraints.oneWayLengthM) || constraints.oneWayLengthM < 0) {
    return failure('invalid_input', ['oneWayLengthM must be finite and non-negative.']);
  }
  if (
    constraints.maximumPercentVoltageDrop !== undefined &&
    (!Number.isFinite(constraints.maximumPercentVoltageDrop) ||
      constraints.maximumPercentVoltageDrop < 0)
  ) {
    return failure('invalid_input', ['maximumPercentVoltageDrop must be finite and non-negative.']);
  }
  const checks = constraints.requiredChecks ?? ['ampacity', 'voltageDrop'];
  const ampacityRequired = checks.includes('ampacity');
  const voltageDropRequired = checks.includes('voltageDrop');
  const reasons: string[] = [];
  let ampacityPasses = true;
  let voltageDropPasses = true;
  let dropPercent: number | undefined;

  if (ampacityRequired) {
    if (ampacityA === undefined || constraints.requiredAmpacityA === undefined) {
      return failure('insufficient_data', [
        'An installation-specific ampacity record and requiredAmpacityA are required for the ampacity check.',
      ]);
    }
    if (
      !Number.isFinite(ampacityA) ||
      ampacityA < 0 ||
      !Number.isFinite(constraints.requiredAmpacityA) ||
      constraints.requiredAmpacityA < 0
    ) {
      return failure('invalid_input', [
        'Ampacity values and requiredAmpacityA must be finite and non-negative.',
      ]);
    }
    ampacityPasses = ampacityA >= constraints.requiredAmpacityA;
    if (!ampacityPasses) reasons.push('Candidate ampacity is below the required ampacity.');
  }
  if (voltageDropRequired) {
    if (
      candidate.resistanceOhmPerM === undefined ||
      constraints.maximumPercentVoltageDrop === undefined
    ) {
      return failure('insufficient_data', [
        'Resistance-per-length data and maximumPercentVoltageDrop are required for the voltage-drop check.',
      ]);
    }
    const conductor = calculateConductor({
      currentA: constraints.currentA,
      nominalVoltageV: constraints.systemVoltageV,
      oneWayLengthM: constraints.oneWayLengthM,
      resistanceOhmPerM: candidate.resistanceOhmPerM,
      roundTrip: constraints.roundTrip,
    });
    if (!conductor.ok) return conductor;
    dropPercent = conductor.value.percentVoltageDrop;
    voltageDropPasses = dropPercent <= constraints.maximumPercentVoltageDrop;
    if (!voltageDropPasses) reasons.push('Candidate voltage drop exceeds the requested maximum.');
  }
  return success({
    candidateId: candidate.id,
    gauge: candidate.gauge,
    eligible: ampacityPasses && voltageDropPasses,
    ampacity: {
      required: ampacityRequired,
      passes: ampacityPasses,
      ...(ampacityA === undefined ? {} : { availableA: ampacityA }),
    },
    voltageDrop: {
      required: voltageDropRequired,
      passes: voltageDropPasses,
      ...(dropPercent === undefined ? {} : { percent: dropPercent }),
    },
    reasons,
  });
};
