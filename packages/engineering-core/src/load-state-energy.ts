import type { EngineeringSeverity } from './battery-power.js';

export type LoadStateClassification = 'active' | 'idle' | 'standby' | 'quiescent' | 'off' | 'other';
export type LoadStatePowerBasis = 'load-side' | 'battery-side' | 'device-side';

export interface LoadStateSource {
  readonly id: string;
  readonly locator?: string;
}

export interface LoadStateEnergyInput {
  readonly contributionId?: string;
  readonly loadId: string;
  readonly instanceId?: string;
  readonly productId?: string;
  readonly stateId: string;
  readonly stateClassification?: LoadStateClassification;
  /** An unsigned component fact. This primitive does not infer or apply a sign. */
  readonly powerW?: number;
  /** An explicit duration for this state interval; no duration means unresolved energy. */
  readonly durationHours?: number;
  readonly powerBasis?: LoadStatePowerBasis;
  readonly source?: LoadStateSource;
  readonly assumptions?: readonly string[];
  /** Explicit relationship metadata for composition; it does not create a schedule. */
  readonly exclusiveWith?: readonly string[];
  /** The referenced contribution already includes this state overhead. */
  readonly includedInContributionId?: string;
  readonly voltageV?: number;
  readonly dutyCycle?: number;
}

export interface LoadStateEnergyResult {
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly contributionId: string;
  readonly loadId: string;
  readonly instanceId?: string;
  readonly productId?: string;
  readonly stateId: string;
  readonly stateClassification?: LoadStateClassification;
  readonly powerW?: number;
  readonly durationHours?: number;
  readonly energyWh?: number;
  readonly netBatteryPowerW?: number;
  readonly netBatteryEnergyWh?: number;
  readonly powerBasis: LoadStatePowerBasis;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly assumptions: readonly string[];
  readonly provenance: {
    readonly loadId: string;
    readonly instanceId?: string;
    readonly productId?: string;
    readonly stateId: string;
    readonly source?: LoadStateSource;
    readonly powerBasis: LoadStatePowerBasis;
    readonly sourcePowerW?: number;
    readonly durationHours?: number;
  };
}

export interface LoadStateEnergyCompositionInput {
  readonly compositionId?: string;
  readonly contributions: readonly LoadStateEnergyInput[];
  /**
   * Each group is an explicit declaration that these contribution identities
   * are concurrent. Facts outside a group are never added automatically.
   */
  readonly concurrency?: readonly (readonly string[])[];
}

export interface LoadStateEnergyCompositionResult {
  readonly compositionId?: string;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly totalPowerW: number;
  readonly totalEnergyWh?: number;
  readonly netBatteryPowerW: number;
  readonly netBatteryEnergyWh?: number;
  readonly contributions: readonly LoadStateEnergyResult[];
  readonly unresolvedContributionIds: readonly string[];
  readonly failedContributionIds: readonly string[];
  readonly issues: readonly string[];
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const validNonNegative = (value: number | undefined): value is number =>
  finite(value) && value >= 0;

export const evaluateLoadStateEnergy = (input: LoadStateEnergyInput): LoadStateEnergyResult => {
  const contributionId = input.contributionId ?? `${input.loadId}:${input.stateId}`;
  const powerBasis = input.powerBasis ?? 'load-side';
  const issues: string[] = [];
  const unresolvedFacts: string[] = [];
  let invalid = false;

  if (input.powerW !== undefined && !validNonNegative(input.powerW)) {
    invalid = true;
    issues.push('powerW must be finite and non-negative.');
  } else if (input.powerW === undefined) {
    unresolvedFacts.push('powerW is unresolved; missing power is not zero.');
  }
  if (input.durationHours !== undefined && !validNonNegative(input.durationHours)) {
    invalid = true;
    issues.push('durationHours must be finite and non-negative.');
  } else if (input.durationHours === undefined) {
    unresolvedFacts.push('durationHours is unresolved; no implicit always-on duration is applied.');
  }

  const resolved = !invalid && input.powerW !== undefined && input.durationHours !== undefined;
  const energyWh = resolved ? input.powerW * input.durationHours : undefined;
  const severity: EngineeringSeverity = invalid ? 'FAIL' : resolved ? 'PASS' : 'CONDITIONAL';

  return {
    severity,
    code: invalid
      ? 'load_state_energy.invalid'
      : resolved
        ? 'load_state_energy.pass'
        : 'load_state_energy.unresolved',
    message: invalid
      ? 'Load state energy contains invalid numeric values.'
      : resolved
        ? 'Load state energy is explicitly resolved.'
        : 'Load state energy retains known facts but requires explicit power and duration.',
    contributionId,
    loadId: input.loadId,
    ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    stateId: input.stateId,
    ...(input.stateClassification === undefined
      ? {}
      : { stateClassification: input.stateClassification }),
    ...(input.powerW === undefined ? {} : { powerW: input.powerW }),
    ...(input.durationHours === undefined ? {} : { durationHours: input.durationHours }),
    ...(energyWh === undefined ? {} : { energyWh, netBatteryEnergyWh: -energyWh }),
    ...(resolved ? { netBatteryPowerW: -input.powerW } : {}),
    powerBasis,
    unresolvedFacts,
    issues,
    assumptions: input.assumptions ?? [],
    provenance: {
      loadId: input.loadId,
      ...(input.instanceId === undefined ? {} : { instanceId: input.instanceId }),
      ...(input.productId === undefined ? {} : { productId: input.productId }),
      stateId: input.stateId,
      ...(input.source === undefined ? {} : { source: input.source }),
      powerBasis,
      ...(input.powerW === undefined ? {} : { sourcePowerW: input.powerW }),
      ...(input.durationHours === undefined ? {} : { durationHours: input.durationHours }),
    },
  };
};

export const composeLoadStateEnergy = (
  input: LoadStateEnergyCompositionInput,
): LoadStateEnergyCompositionResult => {
  const results = input.contributions.map(evaluateLoadStateEnergy);
  const counted = results.filter(
    (_, index) => input.contributions[index]?.includedInContributionId === undefined,
  );
  const unresolvedContributionIds = counted
    .filter((result) => result.severity === 'CONDITIONAL')
    .map((result) => result.contributionId);
  const failedContributionIds = counted
    .filter((result) => result.severity === 'FAIL')
    .map((result) => result.contributionId);
  const resolved = counted.filter(
    (
      result,
    ): result is LoadStateEnergyResult & {
      readonly powerW: number;
      readonly energyWh: number;
    } => result.severity === 'PASS',
  );
  const totalPowerW = resolved.reduce((total, result) => total + result.powerW, 0);
  const totalEnergyWh =
    resolved.length === counted.length
      ? resolved.reduce((total, result) => total + result.energyWh, 0)
      : undefined;
  const issues = [
    ...results.flatMap((result) => result.issues),
    ...results.flatMap((result) => result.unresolvedFacts),
  ];
  const severity: EngineeringSeverity =
    failedContributionIds.length > 0
      ? 'FAIL'
      : unresolvedContributionIds.length > 0
        ? 'CONDITIONAL'
        : 'PASS';

  return {
    compositionId: input.compositionId,
    severity,
    code:
      severity === 'FAIL'
        ? 'load_state_energy_composition.failed'
        : severity === 'CONDITIONAL'
          ? 'load_state_energy_composition.unresolved'
          : 'load_state_energy_composition.pass',
    message:
      severity === 'PASS'
        ? 'Load state contributions are explicitly resolved.'
        : 'Load state composition retains unresolved or invalid contributions.',
    totalPowerW,
    ...(totalEnergyWh === undefined ? {} : { totalEnergyWh, netBatteryEnergyWh: -totalEnergyWh }),
    netBatteryPowerW: -totalPowerW,
    contributions: results,
    unresolvedContributionIds,
    failedContributionIds,
    issues: [...new Set(issues)],
  };
};
