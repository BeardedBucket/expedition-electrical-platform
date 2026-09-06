import type { EngineeringSeverity } from './battery-power.js';

const tolerance = 1e-9;

export interface RechargeWindowFeasibilityInput {
  readonly requirementId?: string;
  readonly requiredRecoveryEnergyWh: number;
  readonly recoveryDurationHours: number;
  readonly acceptedBatterySideChargingPowerW?: number;
  readonly acceptedChargingPowerW?: number;
}

export interface RechargeWindowFeasibilityResult {
  readonly requirementId?: string;
  readonly severity: EngineeringSeverity;
  readonly status: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly requiredRecoveryEnergyWh: number;
  readonly recoveryDurationHours: number;
  readonly requiredAverageChargingPowerW?: number;
  readonly requiredAverageBatterySideChargingPowerW?: number;
  readonly acceptedBatterySideChargingPowerW?: number;
  readonly acceptedChargingPowerW?: number;
  readonly recoverableEnergyWh?: number;
  readonly recoverableBatterySideEnergyWh?: number;
  readonly recoveryFeasible?: boolean;
  readonly energyShortfallWh?: number;
  readonly energySurplusWh?: number;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly requirementId?: string;
    readonly requiredRecoveryEnergyWh: number;
    readonly recoveryDurationHours: number;
    readonly acceptedBatterySideChargingPowerW?: number;
    readonly acceptedChargingPowerW?: number;
    readonly requiredAverageChargingPowerW?: number;
    readonly recoverableEnergyWh?: number;
    readonly energyShortfallWh?: number;
    readonly energySurplusWh?: number;
    readonly formula: string;
  };
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const normalizeNumber = (value: number): number => {
  if (!Number.isFinite(value)) {
    return value;
  }
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const resolveAcceptedPower = (input: RechargeWindowFeasibilityInput): number | undefined =>
  input.acceptedBatterySideChargingPowerW ?? input.acceptedChargingPowerW;

export const evaluateRechargeWindowFeasibility = (
  input: RechargeWindowFeasibilityInput,
): RechargeWindowFeasibilityResult => {
  const requiredRecoveryEnergyWh = normalizeNumber(input.requiredRecoveryEnergyWh);
  const recoveryDurationHours = normalizeNumber(input.recoveryDurationHours);
  const acceptedBatterySideChargingPowerW = resolveAcceptedPower(input);
  const acceptedChargingPowerW = acceptedBatterySideChargingPowerW;
  const issues: string[] = [];
  const unresolvedFacts: string[] = [];

  if (!finite(requiredRecoveryEnergyWh) || requiredRecoveryEnergyWh < 0) {
    issues.push('requiredRecoveryEnergyWh must be finite and non-negative.');
  }
  if (!finite(recoveryDurationHours) || recoveryDurationHours < 0) {
    issues.push('recoveryDurationHours must be finite and non-negative.');
  }
  if (
    acceptedBatterySideChargingPowerW !== undefined &&
    (!finite(acceptedBatterySideChargingPowerW) || acceptedBatterySideChargingPowerW < 0)
  ) {
    issues.push('acceptedBatterySideChargingPowerW must be finite and non-negative.');
  }

  if (issues.length > 0) {
    return {
      requirementId: input.requirementId,
      severity: 'FAIL',
      status: 'FAIL',
      code: 'recharge_window_feasibility.invalid_input',
      message: 'Recharge-window feasibility input validation failed.',
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      requiredAverageChargingPowerW: undefined,
      requiredAverageBatterySideChargingPowerW: undefined,
      acceptedBatterySideChargingPowerW,
      acceptedChargingPowerW,
      recoverableEnergyWh: undefined,
      recoverableBatterySideEnergyWh: undefined,
      recoveryFeasible: false,
      energyShortfallWh: undefined,
      energySurplusWh: undefined,
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: [...new Set(issues)],
      provenance: {
        requirementId: input.requirementId,
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        acceptedBatterySideChargingPowerW,
        acceptedChargingPowerW,
        requiredAverageChargingPowerW: undefined,
        recoverableEnergyWh: undefined,
        energyShortfallWh: undefined,
        energySurplusWh: undefined,
        formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
      },
    };
  }

  if (requiredRecoveryEnergyWh === 0) {
    const zeroRecoveryAveragePowerW = 0;
    if (recoveryDurationHours === 0) {
      return {
        requirementId: input.requirementId,
        severity: 'PASS',
        status: 'PASS',
        code: 'recharge_window_feasibility.no_recovery_required',
        message: 'No recovery is required within the modeled window.',
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
        requiredAverageBatterySideChargingPowerW: zeroRecoveryAveragePowerW,
        acceptedBatterySideChargingPowerW,
        acceptedChargingPowerW,
        recoverableEnergyWh: 0,
        recoverableBatterySideEnergyWh: 0,
        recoveryFeasible: true,
        energyShortfallWh: 0,
        energySurplusWh: 0,
        unresolvedFacts: [...new Set(unresolvedFacts)],
        issues: [...new Set(issues)],
        provenance: {
          requirementId: input.requirementId,
          requiredRecoveryEnergyWh,
          recoveryDurationHours,
          acceptedBatterySideChargingPowerW,
          acceptedChargingPowerW,
          requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
          recoverableEnergyWh: 0,
          energyShortfallWh: 0,
          energySurplusWh: 0,
          formula:
            'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
        },
      };
    }

    if (acceptedBatterySideChargingPowerW === undefined) {
      return {
        requirementId: input.requirementId,
        severity: 'PASS',
        status: 'PASS',
        code: 'recharge_window_feasibility.no_recovery_required',
        message: 'No recovery is required within the modeled window.',
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
        requiredAverageBatterySideChargingPowerW: zeroRecoveryAveragePowerW,
        acceptedBatterySideChargingPowerW: undefined,
        acceptedChargingPowerW: undefined,
        recoverableEnergyWh: undefined,
        recoverableBatterySideEnergyWh: undefined,
        recoveryFeasible: true,
        energyShortfallWh: undefined,
        energySurplusWh: undefined,
        unresolvedFacts: [...new Set(unresolvedFacts)],
        issues: [...new Set(issues)],
        provenance: {
          requirementId: input.requirementId,
          requiredRecoveryEnergyWh,
          recoveryDurationHours,
          acceptedBatterySideChargingPowerW: undefined,
          acceptedChargingPowerW: undefined,
          requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
          recoverableEnergyWh: undefined,
          energyShortfallWh: undefined,
          energySurplusWh: undefined,
          formula:
            'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
        },
      };
    }

    const recoverableEnergyWh = acceptedBatterySideChargingPowerW * recoveryDurationHours;
    return {
      requirementId: input.requirementId,
      severity: 'PASS',
      status: 'PASS',
      code: 'recharge_window_feasibility.no_recovery_required',
      message: 'No recovery is required within the modeled window.',
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
      requiredAverageBatterySideChargingPowerW: zeroRecoveryAveragePowerW,
      acceptedBatterySideChargingPowerW,
      acceptedChargingPowerW,
      recoverableEnergyWh,
      recoverableBatterySideEnergyWh: recoverableEnergyWh,
      recoveryFeasible: true,
      energyShortfallWh: 0,
      energySurplusWh: recoverableEnergyWh,
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: [...new Set(issues)],
      provenance: {
        requirementId: input.requirementId,
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        acceptedBatterySideChargingPowerW,
        acceptedChargingPowerW,
        requiredAverageChargingPowerW: zeroRecoveryAveragePowerW,
        recoverableEnergyWh,
        energyShortfallWh: 0,
        energySurplusWh: recoverableEnergyWh,
        formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
      },
    };
  }

  if (recoveryDurationHours === 0) {
    return {
      requirementId: input.requirementId,
      severity: 'FAIL',
      status: 'FAIL',
      code: 'recharge_window_feasibility.zero_duration_impossible',
      message: 'A positive required recovery energy cannot be restored in a zero-duration window.',
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      requiredAverageChargingPowerW: undefined,
      requiredAverageBatterySideChargingPowerW: undefined,
      acceptedBatterySideChargingPowerW,
      acceptedChargingPowerW,
      recoverableEnergyWh: undefined,
      recoverableBatterySideEnergyWh: undefined,
      recoveryFeasible: false,
      energyShortfallWh: requiredRecoveryEnergyWh,
      energySurplusWh: 0,
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: ['requiredRecoveryEnergyWh > 0 and recoveryDurationHours = 0 is not recoverable.'],
      provenance: {
        requirementId: input.requirementId,
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        acceptedBatterySideChargingPowerW,
        acceptedChargingPowerW,
        requiredAverageChargingPowerW: undefined,
        recoverableEnergyWh: undefined,
        energyShortfallWh: requiredRecoveryEnergyWh,
        energySurplusWh: 0,
        formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
      },
    };
  }

  const requiredAverageChargingPowerW = requiredRecoveryEnergyWh / recoveryDurationHours;
  const requiredAverageBatterySideChargingPowerW = requiredAverageChargingPowerW;

  if (acceptedBatterySideChargingPowerW === undefined) {
    unresolvedFacts.push(
      'Accepted battery-side charging power is required to determine recovery feasibility within the explicit window.',
    );
    return {
      requirementId: input.requirementId,
      severity: 'CONDITIONAL',
      status: 'CONDITIONAL',
      code: 'recharge_window_feasibility.unresolved',
      message:
        'The average required charging power is known, but accepted battery-side charging capability is unresolved.',
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      requiredAverageChargingPowerW,
      requiredAverageBatterySideChargingPowerW,
      acceptedBatterySideChargingPowerW: undefined,
      acceptedChargingPowerW: undefined,
      recoverableEnergyWh: undefined,
      recoverableBatterySideEnergyWh: undefined,
      recoveryFeasible: undefined,
      energyShortfallWh: undefined,
      energySurplusWh: undefined,
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: [...new Set(unresolvedFacts)],
      provenance: {
        requirementId: input.requirementId,
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        acceptedBatterySideChargingPowerW: undefined,
        acceptedChargingPowerW: undefined,
        requiredAverageChargingPowerW,
        recoverableEnergyWh: undefined,
        energyShortfallWh: undefined,
        energySurplusWh: undefined,
        formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
      },
    };
  }

  const recoverableEnergyWh = acceptedBatterySideChargingPowerW * recoveryDurationHours;
  const differenceWh = recoverableEnergyWh - requiredRecoveryEnergyWh;
  const shortfallWh = Math.max(requiredRecoveryEnergyWh - recoverableEnergyWh, 0);
  const surplusWh = Math.max(recoverableEnergyWh - requiredRecoveryEnergyWh, 0);
  const atExactLimit = Math.abs(differenceWh) <= tolerance;
  const feasible = atExactLimit || recoverableEnergyWh >= requiredRecoveryEnergyWh - tolerance;

  if (feasible) {
    return {
      requirementId: input.requirementId,
      severity: 'PASS',
      status: 'PASS',
      code: 'recharge_window_feasibility.pass',
      message: 'The explicit recovery requirement is feasible within the modeled window.',
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      requiredAverageChargingPowerW,
      requiredAverageBatterySideChargingPowerW,
      acceptedBatterySideChargingPowerW,
      acceptedChargingPowerW,
      recoverableEnergyWh,
      recoverableBatterySideEnergyWh: recoverableEnergyWh,
      recoveryFeasible: true,
      energyShortfallWh: 0,
      energySurplusWh: surplusWh,
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: [...new Set(issues)],
      provenance: {
        requirementId: input.requirementId,
        requiredRecoveryEnergyWh,
        recoveryDurationHours,
        acceptedBatterySideChargingPowerW,
        acceptedChargingPowerW,
        requiredAverageChargingPowerW,
        recoverableEnergyWh,
        energyShortfallWh: 0,
        energySurplusWh: surplusWh,
        formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
      },
    };
  }

  return {
    requirementId: input.requirementId,
    severity: 'FAIL',
    status: 'FAIL',
    code: 'recharge_window_feasibility.insufficient_charging_power',
    message:
      'The accepted battery-side charging capability is insufficient to restore the required energy within the modeled window.',
    requiredRecoveryEnergyWh,
    recoveryDurationHours,
    requiredAverageChargingPowerW,
    requiredAverageBatterySideChargingPowerW,
    acceptedBatterySideChargingPowerW,
    acceptedChargingPowerW,
    recoverableEnergyWh,
    recoverableBatterySideEnergyWh: recoverableEnergyWh,
    recoveryFeasible: false,
    energyShortfallWh: shortfallWh,
    energySurplusWh: 0,
    unresolvedFacts: [...new Set(unresolvedFacts)],
    issues: [`Recoverable energy ${recoverableEnergyWh} Wh is short by ${shortfallWh} Wh.`],
    provenance: {
      requirementId: input.requirementId,
      requiredRecoveryEnergyWh,
      recoveryDurationHours,
      acceptedBatterySideChargingPowerW,
      acceptedChargingPowerW,
      requiredAverageChargingPowerW,
      recoverableEnergyWh,
      energyShortfallWh: shortfallWh,
      energySurplusWh: 0,
      formula: 'requiredRecoveryEnergyWh / recoveryDurationHours = requiredAverageChargingPowerW',
    },
  };
};
