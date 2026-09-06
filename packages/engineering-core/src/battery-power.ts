import type { CalculationResult, LoadRequirement } from './contracts.js';

export type VoltageBasis = 'nominal' | 'design' | 'operating';
export type EngineeringSeverity = 'PASS' | 'FAIL' | 'WARNING' | 'CONDITIONAL' | 'INFORMATION';

export interface EngineeringIssue {
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
}

export interface LoadPowerResult {
  readonly powerW: number;
  readonly loads: readonly { id: string; powerW: number; quantity: number }[];
}

export interface BatterySideCurrentInput {
  readonly powerW: number;
  readonly voltageV?: number;
  readonly voltageBasis: VoltageBasis;
  readonly powerBasis: 'dc-side' | 'load-output';
  readonly efficiency?: number;
}

export interface BatterySideCurrentResult {
  readonly currentA: number;
  readonly inputPowerW: number;
  readonly outputPowerW: number;
  readonly voltageV: number;
  readonly voltageBasis: VoltageBasis;
  readonly powerBasis: 'dc-side' | 'load-output';
  readonly efficiency?: number;
}

export interface NominalEnergyInput {
  readonly voltageV: number;
  readonly capacityAh: number;
}

export interface NominalEnergyResult {
  readonly energyWh: number;
  readonly basis: 'calculated';
  readonly voltageV: number;
  readonly capacityAh: number;
}

export interface UsableEnergyPolicy {
  readonly id: string;
  readonly version: string;
}

export interface DesignUsableEnergyInput {
  readonly nominalEnergyWh: number;
  readonly usableFraction?: number;
  readonly policy?: UsableEnergyPolicy;
  readonly assumptions?: readonly string[];
}

export interface DesignUsableEnergyResult {
  readonly usableEnergyWh: number;
  readonly nominalEnergyWh: number;
  readonly usableFraction: number;
  readonly policy: UsableEnergyPolicy;
  readonly assumptions: readonly string[];
  readonly basis: 'calculated';
}

export interface BatteryEngineeringInput {
  readonly id?: string;
  readonly nominalVoltageV: number;
  readonly nominalCapacityAh: number;
  readonly nominalEnergyWh?: number;
  readonly chargeCurrent?: ChargeCurrentSemantics;
  readonly continuousDischargeCurrentA?: number;
  readonly peakDischargeCurrentA?: number;
  readonly peakDischargeDurationS?: number;
  readonly allowedSeriesCount?: { readonly min: number; readonly max: number };
  readonly allowedParallelCount?: { readonly min: number; readonly max: number };
}

export interface BatteryTopology {
  readonly seriesCount: number;
  readonly parallelCount: number;
}

export interface BatteryBankResult extends BatteryTopology {
  readonly totalUnitCount: number;
  readonly nominalVoltageV: number;
  readonly nominalCapacityAh: number;
  readonly nominalEnergyWh: number;
  readonly nominalEnergyBasis: 'manufacturer' | 'calculated';
  readonly continuousDischargeCurrentA?: number;
  readonly peakDischargeCurrentA?: number;
  readonly peakDischargeDurationS?: number;
}

export interface BatteryEvaluationResult extends EngineeringIssue {
  readonly selected: {
    readonly topology: BatteryTopology;
    readonly passes: boolean;
    readonly availableCurrentA?: number;
  };
  readonly alternatives: readonly (BatteryTopology & {
    readonly passes: boolean;
    readonly availableCurrentA?: number;
  })[];
}

export interface BatteryContinuousDischargeInput {
  readonly requiredCurrentA: number;
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
}

export interface BatterySurgeInput {
  readonly requiredCurrentA: number;
  readonly requiredDurationS: number;
  readonly battery: BatteryEngineeringInput;
  readonly topology: BatteryTopology;
}

export interface BatteryNominalVoltageRequirementInput {
  readonly requiredVoltageV: number;
  readonly voltageBasis: VoltageBasis;
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
}

export interface BatteryNominalVoltageEvaluationResult extends EngineeringIssue {
  readonly selected: {
    readonly topology: BatteryTopology;
    readonly achievedVoltageV: number;
    readonly passes: boolean;
  };
  readonly alternatives: readonly (BatteryTopology & {
    readonly achievedVoltageV: number;
    readonly passes: boolean;
  })[];
}

export interface BatteryNominalEnergyRequirementInput {
  readonly requiredEnergyWh: number;
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
}

export interface BatteryNominalEnergyEvaluationResult extends EngineeringIssue {
  readonly selected: {
    readonly topology: BatteryTopology;
    readonly achievedEnergyWh: number;
    readonly achievedEnergyBasis: 'manufacturer' | 'calculated';
    readonly passes: boolean;
  };
  readonly alternatives: readonly (BatteryTopology & {
    readonly achievedEnergyWh: number;
    readonly achievedEnergyBasis: 'manufacturer' | 'calculated';
    readonly passes: boolean;
  })[];
}

export interface FeasibleBankAlternativesInput {
  readonly battery: BatteryEngineeringInput;
}

export interface BatteryBankRequirements {
  readonly nominalVoltageV?: number;
  readonly nominalEnergyWh?: number;
  readonly continuousDischargeCurrentA?: number;
  readonly peakDischargeCurrentA?: number;
  readonly peakDischargeDurationS?: number;
}

export interface BatteryBankConfigurationInput {
  readonly battery: BatteryEngineeringInput;
  readonly selectedTopology: BatteryTopology;
  readonly requirements?: BatteryBankRequirements;
}

export interface BatteryBankRequirementResults {
  nominalVoltage?: BatteryNominalVoltageEvaluationResult;
  nominalEnergy?: BatteryNominalEnergyEvaluationResult;
  continuousDischarge?: BatteryEvaluationResult;
  peakDischarge?: EngineeringIssue;
}

export interface BatteryBankConfigurationResult {
  readonly battery: BatteryEngineeringInput;
  readonly requestedTopology: BatteryTopology;
  readonly topologyLegal: boolean;
  readonly bank?: BatteryBankResult;
  readonly requirementResults: BatteryBankRequirementResults;
  readonly status: EngineeringSeverity;
  readonly severity: EngineeringSeverity;
  readonly issues: readonly EngineeringIssue[];
  readonly reasons: readonly string[];
  readonly unresolvedReasons: readonly string[];
  readonly feasibleAlternatives: readonly BatteryTopology[];
}

export interface FeasibleBankAlternative {
  readonly seriesCount: number;
  readonly parallelCount: number;
  readonly totalUnitCount: number;
  readonly nominalVoltageV: number;
  readonly nominalCapacityAh: number;
  readonly nominalEnergyWh: number;
  readonly nominalEnergyBasis: 'manufacturer' | 'calculated';
  readonly continuousDischargeCurrentA?: number;
  readonly peakDischargeCurrentA?: number;
  readonly peakDischargeDurationS?: number;
}

export interface ChargeCurrentSemantics {
  readonly recommendedA?: number;
  readonly maximumContinuousA?: number;
  readonly protectionLimitA?: number;
}

export interface ChargeEvaluationResult extends EngineeringIssue {
  readonly configuredCurrentA: number;
  readonly limits: ChargeCurrentSemantics;
}

export interface ChargerCapabilityInput {
  readonly ratedOutputW: number;
  readonly configuredOutputLimitW?: number;
  readonly availableInputW?: number;
  readonly efficiency?: number;
}

export interface ChargerCapabilityResult {
  readonly severity: EngineeringSeverity;
  readonly possibleOutputW: number;
  readonly codes: readonly string[];
}

export interface SourceConcurrencyInput {
  readonly activeSourceIds: readonly string[];
  readonly unavailableSourceIds?: readonly string[];
  readonly variableSourceIds?: readonly string[];
  readonly availablePowerW?: Readonly<Record<string, number>>;
  readonly configuredPowerLimitW?: Readonly<Record<string, number>>;
  readonly mutuallyExclusiveGroups?: readonly (readonly string[])[];
}

export interface SourceConcurrencyResult {
  readonly severity: EngineeringSeverity;
  readonly availablePowerW: number;
  readonly code?: string;
}

const invalid = (reasons: readonly string[]): CalculationResult<never> => ({
  ok: false,
  code: 'invalid_input',
  reasons,
  warnings: [],
});

const insufficient = (reasons: readonly string[]): CalculationResult<never> => ({
  ok: false,
  code: 'insufficient_data',
  reasons,
  warnings: [],
});

const validPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const validNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const validInteger = (value: number): boolean => Number.isInteger(value) && value >= 1;

const validRange = (range: { readonly min: number; readonly max: number } | undefined): boolean =>
  range !== undefined &&
  validInteger(range.min) &&
  validInteger(range.max) &&
  range.min <= range.max;

const inRange = (value: number, range: { readonly min: number; readonly max: number }): boolean =>
  value >= range.min && value <= range.max;

export const calculateLoadPower = (
  loads: readonly LoadRequirement[],
): CalculationResult<LoadPowerResult> => {
  if (loads.length === 0) return insufficient(['At least one load is required.']);
  const normalized = loads.map((load) => ({
    id: load.id,
    powerW: load.powerW ?? Number.NaN,
    quantity: load.quantity ?? 1,
  }));
  if (normalized.some((load) => !validNonNegative(load.powerW) || !validPositive(load.quantity))) {
    return invalid(['Every load must have finite non-negative powerW and positive quantity.']);
  }
  return {
    ok: true,
    value: {
      powerW: normalized.reduce((total, load) => total + load.powerW * load.quantity, 0),
      loads: normalized,
    },
    warnings: [],
  };
};

export const calculateBatterySideCurrent = (
  input: BatterySideCurrentInput,
): CalculationResult<BatterySideCurrentResult> => {
  if (!validNonNegative(input.powerW)) return invalid(['powerW must be finite and non-negative.']);
  if (input.voltageV === undefined) {
    return insufficient([
      `${input.voltageBasis} voltage is required; no voltage fallback is applied.`,
    ]);
  }
  if (!validPositive(input.voltageV)) return invalid(['voltageV must be finite and positive.']);
  if (
    input.efficiency !== undefined &&
    (!validPositive(input.efficiency) || input.efficiency > 1)
  ) {
    return invalid(['efficiency must be greater than 0 and no greater than 1.']);
  }
  if (input.powerBasis === 'load-output' && input.efficiency === undefined) {
    return insufficient(['An explicit efficiency is required for load-output power.']);
  }
  const efficiency = input.efficiency ?? 1;
  const inputPowerW = input.powerW / efficiency;
  return {
    ok: true,
    value: {
      currentA: inputPowerW / input.voltageV,
      inputPowerW,
      outputPowerW: input.powerW,
      voltageV: input.voltageV,
      voltageBasis: input.voltageBasis,
      powerBasis: input.powerBasis,
      ...(input.efficiency === undefined ? {} : { efficiency: input.efficiency }),
    },
    warnings: [],
  };
};

export const calculateNominalEnergy = (
  input: NominalEnergyInput,
): CalculationResult<NominalEnergyResult> => {
  if (!validPositive(input.voltageV) || !validNonNegative(input.capacityAh)) {
    return invalid(['voltageV must be positive and capacityAh must be non-negative.']);
  }
  return {
    ok: true,
    value: {
      energyWh: input.voltageV * input.capacityAh,
      basis: 'calculated',
      voltageV: input.voltageV,
      capacityAh: input.capacityAh,
    },
    warnings: [],
  };
};

export const calculateDesignUsableEnergy = (
  input: DesignUsableEnergyInput,
): CalculationResult<DesignUsableEnergyResult> => {
  if (!validNonNegative(input.nominalEnergyWh))
    return invalid(['nominalEnergyWh must be non-negative.']);
  if (input.usableFraction === undefined || input.policy === undefined) {
    return insufficient(['An explicit usable fraction and policy identity are required.']);
  }
  if (
    input.usableFraction < 0 ||
    input.usableFraction > 1 ||
    !Number.isFinite(input.usableFraction)
  ) {
    return invalid(['usableFraction must be finite and between 0 and 1.']);
  }
  if (!input.policy.id || !input.policy.version)
    return invalid(['policy id and version are required.']);
  return {
    ok: true,
    value: {
      usableEnergyWh: input.nominalEnergyWh * input.usableFraction,
      nominalEnergyWh: input.nominalEnergyWh,
      usableFraction: input.usableFraction,
      policy: input.policy,
      assumptions: input.assumptions ?? [],
      basis: 'calculated',
    },
    warnings: [],
  };
};

export const deriveBatteryBank = (
  battery: BatteryEngineeringInput,
  topology: BatteryTopology,
): CalculationResult<BatteryBankResult> => {
  if (!validPositive(battery.nominalVoltageV) || !validNonNegative(battery.nominalCapacityAh)) {
    return invalid(['Battery nominal voltage and capacity must be valid.']);
  }
  if (!validInteger(topology.seriesCount) || !validInteger(topology.parallelCount)) {
    return invalid(['Series and parallel counts must be positive integers.']);
  }
  if (!validRange(battery.allowedSeriesCount) || !validRange(battery.allowedParallelCount)) {
    return insufficient([
      'Explicit series-per-string and parallel-string permissions are required.',
    ]);
  }
  const allowedSeriesCount = battery.allowedSeriesCount;
  const allowedParallelCount = battery.allowedParallelCount;
  if (allowedSeriesCount === undefined || allowedParallelCount === undefined) {
    return insufficient([
      'Explicit series-per-string and parallel-string permissions are required.',
    ]);
  }
  if (
    !inRange(topology.seriesCount, allowedSeriesCount) ||
    !inRange(topology.parallelCount, allowedParallelCount)
  ) {
    return invalid(['Selected topology is outside the manufacturer-permitted ranges.']);
  }
  const nominalEnergyWh =
    battery.nominalEnergyWh ?? battery.nominalVoltageV * battery.nominalCapacityAh;
  return {
    ok: true,
    value: {
      ...topology,
      totalUnitCount: topology.seriesCount * topology.parallelCount,
      nominalVoltageV: battery.nominalVoltageV * topology.seriesCount,
      nominalCapacityAh: battery.nominalCapacityAh * topology.parallelCount,
      nominalEnergyWh: nominalEnergyWh * topology.seriesCount * topology.parallelCount,
      nominalEnergyBasis: battery.nominalEnergyWh === undefined ? 'calculated' : 'manufacturer',
      ...(battery.continuousDischargeCurrentA === undefined
        ? {}
        : {
            continuousDischargeCurrentA:
              battery.continuousDischargeCurrentA * topology.parallelCount,
          }),
      ...(battery.peakDischargeCurrentA === undefined
        ? {}
        : { peakDischargeCurrentA: battery.peakDischargeCurrentA * topology.parallelCount }),
      ...(battery.peakDischargeDurationS === undefined
        ? {}
        : { peakDischargeDurationS: battery.peakDischargeDurationS }),
    },
    warnings: [],
  };
};

const bankAlternatives = (
  input: BatteryContinuousDischargeInput,
): readonly BatteryEvaluationResult['alternatives'][number][] => {
  const alternatives: BatteryEvaluationResult['alternatives'][number][] = [];
  const maxParallel = input.battery.allowedParallelCount?.max;
  if (maxParallel === undefined) return alternatives;
  for (
    let parallelCount = input.selectedTopology.parallelCount + 1;
    parallelCount <= maxParallel;
    parallelCount += 1
  ) {
    const bank = deriveBatteryBank(input.battery, {
      seriesCount: input.selectedTopology.seriesCount,
      parallelCount,
    });
    if (bank.ok) {
      alternatives.push({
        seriesCount: input.selectedTopology.seriesCount,
        parallelCount,
        passes: (bank.value.continuousDischargeCurrentA ?? 0) >= input.requiredCurrentA,
        availableCurrentA: bank.value.continuousDischargeCurrentA,
      });
    }
  }
  return alternatives;
};

export const evaluateBatteryContinuousDischarge = (
  input: BatteryContinuousDischargeInput,
): BatteryEvaluationResult => {
  if (!validNonNegative(input.requiredCurrentA)) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.continuous_discharge_insufficient',
      message: 'Required continuous current is missing or invalid.',
      selected: { topology: input.selectedTopology, passes: false },
      alternatives: [],
    };
  }
  const selected = deriveBatteryBank(input.battery, input.selectedTopology);
  if (!selected.ok) {
    return {
      severity: selected.code === 'invalid_input' ? 'FAIL' : 'CONDITIONAL',
      code: 'battery.bank.topology_not_permitted',
      message: selected.reasons[0] ?? 'Selected topology cannot be evaluated.',
      selected: { topology: input.selectedTopology, passes: false },
      alternatives: [],
    };
  }
  if (input.battery.continuousDischargeCurrentA === undefined) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.continuous_discharge_insufficient',
      message: 'Continuous discharge capability is unavailable.',
      selected: { topology: input.selectedTopology, passes: false },
      alternatives: [],
    };
  }
  const availableCurrentA = selected.value.continuousDischargeCurrentA!;
  const passes = availableCurrentA >= input.requiredCurrentA;
  const alternatives = passes ? [] : bankAlternatives(input);
  if (passes) {
    return {
      severity: 'PASS',
      code: 'battery.bank.continuous_discharge_pass',
      message: 'Selected battery bank satisfies the continuous discharge requirement.',
      selected: { topology: input.selectedTopology, passes, availableCurrentA },
      alternatives,
    };
  }
  const passingAlternative = alternatives.find((alternative) => alternative.passes);
  const maxParallel =
    input.battery.allowedParallelCount?.max ?? input.selectedTopology.parallelCount;
  return {
    severity: passingAlternative
      ? 'FAIL'
      : maxParallel <= input.selectedTopology.parallelCount
        ? 'FAIL'
        : 'FAIL',
    code: passingAlternative
      ? 'battery.bank.continuous_discharge_insufficient'
      : maxParallel <= input.selectedTopology.parallelCount
        ? 'battery.bank.parallel_not_permitted'
        : 'battery.bank.max_parallel_insufficient',
    message: passingAlternative
      ? 'Selected bank is inadequate; a permitted larger parallel bank may satisfy the requirement.'
      : maxParallel <= input.selectedTopology.parallelCount
        ? 'Selected bank is inadequate and no larger permitted parallel bank exists.'
        : 'The maximum permitted parallel bank remains inadequate.',
    selected: { topology: input.selectedTopology, passes, availableCurrentA },
    alternatives,
  };
};

export const evaluateBatterySurge = (input: BatterySurgeInput): EngineeringIssue => {
  if (!validNonNegative(input.requiredCurrentA) || !validNonNegative(input.requiredDurationS)) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.surge_insufficient',
      message: 'Surge requirements are invalid.',
    };
  }
  const bank = deriveBatteryBank(input.battery, input.topology);
  if (!bank.ok)
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.topology_not_permitted',
      message: bank.reasons[0] ?? 'Topology unavailable.',
    };
  if (input.battery.peakDischargeCurrentA === undefined) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.surge_insufficient',
      message: 'Peak discharge current is unavailable.',
    };
  }
  if (input.requiredCurrentA > (bank.value.peakDischargeCurrentA ?? 0)) {
    return {
      severity: 'FAIL',
      code: 'battery.bank.surge_insufficient',
      message: 'Required surge current exceeds bank capability.',
    };
  }
  if (input.battery.peakDischargeDurationS === undefined) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.surge_duration_missing',
      message: 'Peak discharge duration is not specified.',
    };
  }
  if (input.requiredDurationS > input.battery.peakDischargeDurationS) {
    return {
      severity: 'FAIL',
      code: 'battery.bank.surge_duration_insufficient',
      message: 'Required surge duration exceeds supported duration.',
    };
  }
  return {
    severity: 'PASS',
    code: 'battery.bank.surge_pass',
    message: 'Required surge current and duration are supported.',
  };
};

const voltageAlternatives = (
  input: BatteryNominalVoltageRequirementInput,
): readonly BatteryNominalVoltageEvaluationResult['alternatives'][number][] => {
  const alternatives: BatteryNominalVoltageEvaluationResult['alternatives'][number][] = [];
  const maxSeries = input.battery.allowedSeriesCount?.max;
  const selectedSeries = input.selectedTopology.seriesCount;
  if (maxSeries === undefined || maxSeries <= selectedSeries) return alternatives;

  for (let seriesCount = selectedSeries + 1; seriesCount <= maxSeries; seriesCount += 1) {
    const bank = deriveBatteryBank(input.battery, {
      seriesCount,
      parallelCount: input.selectedTopology.parallelCount,
    });
    if (bank.ok) {
      alternatives.push({
        seriesCount,
        parallelCount: input.selectedTopology.parallelCount,
        achievedVoltageV: bank.value.nominalVoltageV,
        passes: bank.value.nominalVoltageV === input.requiredVoltageV,
      });
    }
  }
  return alternatives;
};

export const evaluateBatteryNominalVoltage = (
  input: BatteryNominalVoltageRequirementInput,
): BatteryNominalVoltageEvaluationResult => {
  if (!validPositive(input.requiredVoltageV)) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.voltage_requirement_invalid',
      message: 'Required voltage is missing or invalid.',
      selected: { topology: input.selectedTopology, achievedVoltageV: 0, passes: false },
      alternatives: [],
    };
  }
  const selected = deriveBatteryBank(input.battery, input.selectedTopology);
  if (!selected.ok) {
    return {
      severity: selected.code === 'invalid_input' ? 'FAIL' : 'CONDITIONAL',
      code: 'battery.bank.topology_not_permitted',
      message: selected.reasons[0] ?? 'Selected topology cannot be evaluated.',
      selected: { topology: input.selectedTopology, achievedVoltageV: 0, passes: false },
      alternatives: [],
    };
  }
  const achievedVoltageV = selected.value.nominalVoltageV;
  const passes = achievedVoltageV === input.requiredVoltageV;
  const alternatives = passes ? [] : voltageAlternatives(input);

  if (passes) {
    return {
      severity: 'PASS',
      code: 'battery.bank.voltage_requirement_pass',
      message: `Selected bank achieves ${achievedVoltageV}V, satisfying the ${input.requiredVoltageV}V requirement.`,
      selected: { topology: input.selectedTopology, achievedVoltageV, passes },
      alternatives,
    };
  }
  const passingAlternative = alternatives.find((alt) => alt.passes);
  const maxSeries = input.battery.allowedSeriesCount?.max ?? input.selectedTopology.seriesCount;
  return {
    severity: passingAlternative
      ? 'FAIL'
      : maxSeries <= input.selectedTopology.seriesCount
        ? 'FAIL'
        : 'FAIL',
    code: passingAlternative
      ? 'battery.bank.voltage_requirement_insufficient'
      : maxSeries <= input.selectedTopology.seriesCount
        ? 'battery.bank.series_not_permitted'
        : 'battery.bank.max_series_insufficient',
    message: passingAlternative
      ? `Selected bank achieves ${achievedVoltageV}V; a larger series configuration may satisfy ${input.requiredVoltageV}V requirement.`
      : maxSeries <= input.selectedTopology.seriesCount
        ? `Selected bank achieves ${achievedVoltageV}V, but no larger permitted series bank exists.`
        : `Maximum permitted series configuration remains insufficient for ${input.requiredVoltageV}V.`,
    selected: { topology: input.selectedTopology, achievedVoltageV, passes },
    alternatives,
  };
};

const energyAlternatives = (
  input: BatteryNominalEnergyRequirementInput,
): readonly BatteryNominalEnergyEvaluationResult['alternatives'][number][] => {
  const alternatives: BatteryNominalEnergyEvaluationResult['alternatives'][number][] = [];
  const maxSeries = input.battery.allowedSeriesCount?.max ?? 1;
  const maxParallel = input.battery.allowedParallelCount?.max ?? 1;
  const selectedSeries = input.selectedTopology.seriesCount;
  const selectedParallel = input.selectedTopology.parallelCount;

  for (let seriesCount = 1; seriesCount <= maxSeries; seriesCount += 1) {
    for (let parallelCount = 1; parallelCount <= maxParallel; parallelCount += 1) {
      if (seriesCount === selectedSeries && parallelCount === selectedParallel) continue;

      const bank = deriveBatteryBank(input.battery, { seriesCount, parallelCount });
      if (bank.ok) {
        const achievedEnergyWh = bank.value.nominalEnergyWh;
        alternatives.push({
          seriesCount,
          parallelCount,
          achievedEnergyWh,
          achievedEnergyBasis: bank.value.nominalEnergyBasis,
          passes: achievedEnergyWh >= input.requiredEnergyWh,
        });
      }
    }
  }

  alternatives.sort((a, b) => {
    const aCount = a.seriesCount * a.parallelCount;
    const bCount = b.seriesCount * b.parallelCount;
    if (aCount !== bCount) return aCount - bCount;
    if (a.seriesCount !== b.seriesCount) return a.seriesCount - b.seriesCount;
    return a.parallelCount - b.parallelCount;
  });

  return alternatives;
};

export const evaluateBatteryNominalEnergy = (
  input: BatteryNominalEnergyRequirementInput,
): BatteryNominalEnergyEvaluationResult => {
  if (!validPositive(input.requiredEnergyWh)) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.energy_requirement_invalid',
      message: 'Required energy is missing or invalid.',
      selected: {
        topology: input.selectedTopology,
        achievedEnergyWh: 0,
        achievedEnergyBasis: 'calculated',
        passes: false,
      },
      alternatives: [],
    };
  }
  const selected = deriveBatteryBank(input.battery, input.selectedTopology);
  if (!selected.ok) {
    return {
      severity: selected.code === 'invalid_input' ? 'FAIL' : 'CONDITIONAL',
      code: 'battery.bank.topology_not_permitted',
      message: selected.reasons[0] ?? 'Selected topology cannot be evaluated.',
      selected: {
        topology: input.selectedTopology,
        achievedEnergyWh: 0,
        achievedEnergyBasis: 'calculated',
        passes: false,
      },
      alternatives: [],
    };
  }
  const achievedEnergyWh = selected.value.nominalEnergyWh;
  const achievedEnergyBasis = selected.value.nominalEnergyBasis;
  const passes = achievedEnergyWh >= input.requiredEnergyWh;
  const alternatives = energyAlternatives(input);

  if (passes) {
    return {
      severity: 'PASS',
      code: 'battery.bank.energy_requirement_pass',
      message: `Selected bank provides ${achievedEnergyWh}Wh, satisfying the ${input.requiredEnergyWh}Wh requirement.`,
      selected: { topology: input.selectedTopology, achievedEnergyWh, achievedEnergyBasis, passes },
      alternatives,
    };
  }
  const passingAlternative = alternatives.find((alt) => alt.passes);
  return {
    severity: passingAlternative ? 'FAIL' : 'FAIL',
    code: passingAlternative
      ? 'battery.bank.energy_requirement_insufficient'
      : 'battery.bank.no_feasible_topology',
    message: passingAlternative
      ? `Selected bank provides ${achievedEnergyWh}Wh; feasible alternatives satisfy ${input.requiredEnergyWh}Wh.`
      : `No feasible topology within manufacturer limits provides ${input.requiredEnergyWh}Wh.`,
    selected: { topology: input.selectedTopology, achievedEnergyWh, achievedEnergyBasis, passes },
    alternatives,
  };
};

export const enumerateFeasibleBankConfigurations = (
  input: FeasibleBankAlternativesInput,
): readonly FeasibleBankAlternative[] => {
  const alternatives: FeasibleBankAlternative[] = [];
  const maxSeries = input.battery.allowedSeriesCount?.max;
  const maxParallel = input.battery.allowedParallelCount?.max;

  if (maxSeries === undefined || maxParallel === undefined) return alternatives;

  for (let seriesCount = 1; seriesCount <= maxSeries; seriesCount += 1) {
    for (let parallelCount = 1; parallelCount <= maxParallel; parallelCount += 1) {
      const bank = deriveBatteryBank(input.battery, { seriesCount, parallelCount });
      if (bank.ok) {
        alternatives.push(bank.value);
      }
    }
  }

  alternatives.sort((a, b) => {
    const aTotalCount = a.totalUnitCount;
    const bTotalCount = b.totalUnitCount;
    if (aTotalCount !== bTotalCount) return aTotalCount - bTotalCount;
    if (a.seriesCount !== b.seriesCount) return a.seriesCount - b.seriesCount;
    return a.parallelCount - b.parallelCount;
  });

  return alternatives;
};

const evaluateRequiredPeakDischarge = (
  battery: BatteryEngineeringInput,
  topology: BatteryTopology,
  requirement: BatteryBankRequirements,
): EngineeringIssue => {
  const hasCurrent = requirement.peakDischargeCurrentA !== undefined;
  const hasDuration = requirement.peakDischargeDurationS !== undefined;

  if (!hasCurrent && !hasDuration) {
    return {
      severity: 'PASS',
      code: 'battery.bank.peak_requirement_not_requested',
      message: 'No peak discharge requirement was requested.',
    };
  }

  if (!hasCurrent || !hasDuration) {
    return {
      severity: 'CONDITIONAL',
      code: 'battery.bank.peak_requirement_incomplete',
      message: 'Peak discharge requirement is incomplete: both current and duration are required.',
    };
  }

  return evaluateBatterySurge({
    requiredCurrentA: requirement.peakDischargeCurrentA,
    requiredDurationS: requirement.peakDischargeDurationS,
    battery,
    topology,
  });
};

const evaluateBatteryBankConfigurationInternal = (
  input: BatteryBankConfigurationInput,
): Omit<BatteryBankConfigurationResult, 'feasibleAlternatives'> => {
  const requirements = input.requirements ?? {};
  const selectedBank = deriveBatteryBank(input.battery, input.selectedTopology);
  const requirementResults: BatteryBankRequirementResults = {};

  const issues: EngineeringIssue[] = [];
  const unresolvedReasons: string[] = [];
  const reasons: string[] = [];

  if (!selectedBank.ok) {
    const topologyIssue: EngineeringIssue = {
      severity: selectedBank.code === 'invalid_input' ? 'FAIL' : 'CONDITIONAL',
      code: 'battery.bank.topology_not_permitted',
      message: selectedBank.reasons[0] ?? 'Selected topology cannot be evaluated.',
    };
    issues.push(topologyIssue);
    reasons.push(topologyIssue.message);
    if (topologyIssue.severity === 'CONDITIONAL') {
      unresolvedReasons.push(topologyIssue.message);
    }
    return {
      battery: input.battery,
      requestedTopology: input.selectedTopology,
      topologyLegal: false,
      bank: undefined,
      requirementResults,
      status: topologyIssue.severity,
      severity: topologyIssue.severity,
      issues,
      reasons,
      unresolvedReasons,
    };
  }

  if (requirements.nominalVoltageV !== undefined) {
    const nominalVoltageResult = evaluateBatteryNominalVoltage({
      requiredVoltageV: requirements.nominalVoltageV,
      voltageBasis: 'nominal',
      battery: input.battery,
      selectedTopology: input.selectedTopology,
    });
    requirementResults.nominalVoltage = nominalVoltageResult;
    issues.push({
      severity: nominalVoltageResult.severity,
      code: nominalVoltageResult.code,
      message: nominalVoltageResult.message,
    });
    if (
      nominalVoltageResult.severity === 'FAIL' ||
      nominalVoltageResult.severity === 'CONDITIONAL'
    ) {
      reasons.push(nominalVoltageResult.message);
    }
    if (nominalVoltageResult.severity === 'CONDITIONAL') {
      unresolvedReasons.push(nominalVoltageResult.message);
    }
  }

  if (requirements.nominalEnergyWh !== undefined) {
    const nominalEnergyResult = evaluateBatteryNominalEnergy({
      requiredEnergyWh: requirements.nominalEnergyWh,
      battery: input.battery,
      selectedTopology: input.selectedTopology,
    });
    requirementResults.nominalEnergy = nominalEnergyResult;
    issues.push({
      severity: nominalEnergyResult.severity,
      code: nominalEnergyResult.code,
      message: nominalEnergyResult.message,
    });
    if (nominalEnergyResult.severity === 'FAIL' || nominalEnergyResult.severity === 'CONDITIONAL') {
      reasons.push(nominalEnergyResult.message);
    }
    if (nominalEnergyResult.severity === 'CONDITIONAL') {
      unresolvedReasons.push(nominalEnergyResult.message);
    }
  }

  if (requirements.continuousDischargeCurrentA !== undefined) {
    const continuousDischargeResult = evaluateBatteryContinuousDischarge({
      requiredCurrentA: requirements.continuousDischargeCurrentA,
      battery: input.battery,
      selectedTopology: input.selectedTopology,
    });
    requirementResults.continuousDischarge = continuousDischargeResult;
    issues.push({
      severity: continuousDischargeResult.severity,
      code: continuousDischargeResult.code,
      message: continuousDischargeResult.message,
    });
    if (
      continuousDischargeResult.severity === 'FAIL' ||
      continuousDischargeResult.severity === 'CONDITIONAL'
    ) {
      reasons.push(continuousDischargeResult.message);
    }
    if (continuousDischargeResult.severity === 'CONDITIONAL') {
      unresolvedReasons.push(continuousDischargeResult.message);
    }
  }

  const peakDischargeIssue = evaluateRequiredPeakDischarge(
    input.battery,
    input.selectedTopology,
    requirements,
  );
  if (
    requirements.peakDischargeCurrentA !== undefined ||
    requirements.peakDischargeDurationS !== undefined
  ) {
    requirementResults.peakDischarge = peakDischargeIssue;
    issues.push(peakDischargeIssue);
    if (peakDischargeIssue.severity === 'FAIL' || peakDischargeIssue.severity === 'CONDITIONAL') {
      reasons.push(peakDischargeIssue.message);
    }
    if (peakDischargeIssue.severity === 'CONDITIONAL') {
      unresolvedReasons.push(peakDischargeIssue.message);
    }
  }

  const knownChecks = issues.filter(
    (issue) => issue.code !== 'battery.bank.peak_requirement_not_requested',
  );
  const status: EngineeringSeverity =
    knownChecks.length === 0
      ? 'PASS'
      : knownChecks.some((issue) => issue.severity === 'FAIL')
        ? 'FAIL'
        : knownChecks.some((issue) => issue.severity === 'CONDITIONAL')
          ? 'CONDITIONAL'
          : 'PASS';

  return {
    battery: input.battery,
    requestedTopology: input.selectedTopology,
    topologyLegal: true,
    bank: selectedBank.value,
    requirementResults,
    status,
    severity: status,
    issues,
    reasons,
    unresolvedReasons,
  };
};

export const evaluateBatteryBankConfiguration = (
  input: BatteryBankConfigurationInput,
): BatteryBankConfigurationResult => {
  const baseResult = evaluateBatteryBankConfigurationInternal(input);
  const feasibleAlternatives = enumerateFeasibleBankConfigurations({
    battery: input.battery,
  }).filter((candidate) => {
    if (
      candidate.seriesCount === input.selectedTopology.seriesCount &&
      candidate.parallelCount === input.selectedTopology.parallelCount
    ) {
      return false;
    }
    const candidateResult = evaluateBatteryBankConfigurationInternal({
      battery: input.battery,
      selectedTopology: {
        seriesCount: candidate.seriesCount,
        parallelCount: candidate.parallelCount,
      },
      requirements: input.requirements,
    });
    return candidateResult.status === 'PASS';
  });

  const formattedAlternatives = feasibleAlternatives.map(({ seriesCount, parallelCount }) => ({
    seriesCount,
    parallelCount,
  }));

  return {
    ...baseResult,
    feasibleAlternatives: formattedAlternatives,
  };
};

export const enumerateFeasibleBankConfigurationsForRequirements = (
  input: BatteryBankConfigurationInput,
): readonly BatteryTopology[] => {
  const alternativeResults = enumerateFeasibleBankConfigurations({ battery: input.battery }).filter(
    (candidate) => {
      if (
        candidate.seriesCount === input.selectedTopology.seriesCount &&
        candidate.parallelCount === input.selectedTopology.parallelCount
      ) {
        return false;
      }
      const candidateResult = evaluateBatteryBankConfigurationInternal({
        battery: input.battery,
        selectedTopology: {
          seriesCount: candidate.seriesCount,
          parallelCount: candidate.parallelCount,
        },
        requirements: input.requirements,
      });
      return candidateResult.status === 'PASS';
    },
  );
  return alternativeResults.map(({ seriesCount, parallelCount }) => ({
    seriesCount,
    parallelCount,
  }));
};

export const evaluateChargeRate = (input: {
  readonly configuredCurrentA: number;
  readonly chargeCurrent: ChargeCurrentSemantics;
}): ChargeEvaluationResult => {
  const { configuredCurrentA, chargeCurrent } = input;
  if (!validNonNegative(configuredCurrentA))
    return {
      severity: 'CONDITIONAL',
      code: 'battery.charge.semantics_unknown',
      message: 'Configured charge current is invalid.',
      configuredCurrentA,
      limits: chargeCurrent,
    };
  if (
    chargeCurrent.protectionLimitA !== undefined &&
    configuredCurrentA > chargeCurrent.protectionLimitA
  ) {
    return {
      severity: 'FAIL',
      code: 'battery.charge.protection_limit_exceeded',
      message: 'Configured charge current exceeds the protection limit.',
      configuredCurrentA,
      limits: chargeCurrent,
    };
  }
  if (
    chargeCurrent.maximumContinuousA !== undefined &&
    configuredCurrentA > chargeCurrent.maximumContinuousA
  ) {
    return {
      severity: 'FAIL',
      code: 'battery.charge.configuration_limit_exceeded',
      message: 'Configured charge current exceeds maximum continuous charge current.',
      configuredCurrentA,
      limits: chargeCurrent,
    };
  }
  if (chargeCurrent.recommendedA !== undefined && configuredCurrentA > chargeCurrent.recommendedA) {
    return {
      severity: 'WARNING',
      code: 'battery.charge.recommended_rate_exceeded',
      message: 'Configured charge current exceeds the recommended charge rate.',
      configuredCurrentA,
      limits: chargeCurrent,
    };
  }
  return {
    severity: 'PASS',
    code: 'battery.charge.within_limits',
    message: 'Configured charge current is within supplied charge semantics.',
    configuredCurrentA,
    limits: chargeCurrent,
  };
};

export const evaluateChargerCapability = (
  input: ChargerCapabilityInput,
): ChargerCapabilityResult => {
  if (!validNonNegative(input.ratedOutputW))
    return {
      severity: 'CONDITIONAL',
      possibleOutputW: 0,
      codes: ['charger.output.rated_capability_missing'],
    };
  if (input.configuredOutputLimitW !== undefined && !validNonNegative(input.configuredOutputLimitW))
    return {
      severity: 'CONDITIONAL',
      possibleOutputW: 0,
      codes: ['charger.output.configuration_limited'],
    };
  if (input.availableInputW !== undefined && !validNonNegative(input.availableInputW))
    return { severity: 'CONDITIONAL', possibleOutputW: 0, codes: ['charger.output.input_limited'] };
  if (input.efficiency !== undefined && (!validPositive(input.efficiency) || input.efficiency > 1))
    return { severity: 'CONDITIONAL', possibleOutputW: 0, codes: ['charger.output.input_limited'] };
  const possibleValues = [input.ratedOutputW];
  const codes: string[] = [];
  if (input.configuredOutputLimitW !== undefined) {
    possibleValues.push(input.configuredOutputLimitW);
    if (input.configuredOutputLimitW < input.ratedOutputW)
      codes.push('charger.output.configuration_limited');
  }
  if (input.availableInputW !== undefined) {
    possibleValues.push(input.availableInputW * (input.efficiency ?? 1));
    if (input.availableInputW * (input.efficiency ?? 1) < input.ratedOutputW)
      codes.push('charger.output.input_limited');
  }
  return {
    severity: 'PASS',
    possibleOutputW: Math.min(...possibleValues),
    codes: [...new Set(codes)],
  };
};

export const evaluateSourceConcurrency = (
  input: SourceConcurrencyInput,
): SourceConcurrencyResult => {
  const active = new Set(input.activeSourceIds);
  const unavailable = new Set(input.unavailableSourceIds ?? []);
  for (const group of input.mutuallyExclusiveGroups ?? []) {
    if (group.filter((id) => active.has(id)).length > 1) {
      return {
        severity: 'FAIL',
        availablePowerW: 0,
        code: 'source.concurrent_combination_invalid',
      };
    }
  }
  if ([...active].some((id) => unavailable.has(id))) {
    return {
      severity: 'CONDITIONAL',
      availablePowerW: 0,
      code: 'source.not_available_in_scenario',
    };
  }
  const values = input.availablePowerW ?? {};
  const configured = input.configuredPowerLimitW ?? {};
  const variable = new Set(input.variableSourceIds ?? []);
  const missingVariable = [...active].some((id) => variable.has(id) && values[id] === undefined);
  if (missingVariable)
    return { severity: 'CONDITIONAL', availablePowerW: 0, code: 'source.variable_capability' };
  if ([...active].some((id) => values[id] === undefined)) {
    return {
      severity: 'CONDITIONAL',
      availablePowerW: 0,
      code: 'source.available_capability_missing',
    };
  }
  return {
    severity: 'PASS',
    availablePowerW: [...active].reduce(
      (total, id) => total + Math.min(values[id]!, configured[id] ?? Number.POSITIVE_INFINITY),
      0,
    ),
  };
};
