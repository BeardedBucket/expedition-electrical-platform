import type { EngineeringSeverity } from './battery-power.js';
import type { OperatingPowerBalanceResult } from './operating-power-balance.js';

export interface OperatingCaseUsageInput {
  readonly usageId?: string;
  readonly operatingCase: OperatingPowerBalanceResult;
  readonly activeDurationHours: number;
}

export interface UsageProfileEnergyInput {
  readonly profileId?: string;
  readonly periodHours: number;
  readonly entries: readonly OperatingCaseUsageInput[];
}

export interface UsageProfileEnergyEntryResult {
  readonly usageId: string;
  readonly operatingCaseId?: string;
  readonly activeDurationHours: number;
  readonly energyStatus: 'resolved' | 'unresolved';
  readonly netBatteryPowerW?: number;
  readonly netBatteryEnergyWh?: number;
  readonly chargingEnergyWh?: number;
  readonly dischargeEnergyWh?: number;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly operatingCaseId?: string;
    readonly activeDurationHours: number;
    readonly sourceNetBatteryPowerW?: number;
    readonly sourceChargingSurplusW?: number;
    readonly sourceDischargeDeficitW?: number;
  };
}

export interface UsageProfileEnergyResult {
  readonly profileId?: string;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly periodHours: number;
  readonly modeledDurationHours: number;
  readonly unmodeledDurationHours: number;
  readonly temporalCoverage: 'complete' | 'partial';
  readonly temporalCoverageFraction: number | undefined;
  readonly totalResolvedChargingEnergyWh: number;
  readonly totalResolvedDischargeEnergyWh: number;
  readonly knownNetBatteryEnergyWh: number;
  readonly profileNetBatteryEnergyWh?: number;
  readonly unresolvedUsageIds: readonly string[];
  readonly failedUsageIds: readonly string[];
  readonly entries: readonly UsageProfileEnergyEntryResult[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly periodHours: number;
    readonly modeledDurationHours: number;
    readonly energyBasis: 'resolved operating-case battery-side rates';
  };
}

const tolerance = 1e-9;
const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);
const validNonNegative = (value: number | undefined): value is number =>
  finite(value) && value >= 0;
const sameWithinTolerance = (left: number, right: number): boolean =>
  Math.abs(left - right) <= tolerance;

export const evaluateUsageProfileEnergy = (
  input: UsageProfileEnergyInput,
): UsageProfileEnergyResult => {
  const entries = input.entries ?? [];
  const issues: string[] = [];
  const unresolvedUsageIds: string[] = [];
  const failedUsageIds: string[] = [];
  const usageIds = new Set<string>();
  const invalidPeriod = !finite(input.periodHours) || input.periodHours <= 0;

  if (invalidPeriod) {
    issues.push('periodHours must be finite and greater than zero.');
  }

  const entryResults: UsageProfileEnergyEntryResult[] = [];
  let modeledDurationHours = 0;
  let totalResolvedChargingEnergyWh = 0;
  let totalResolvedDischargeEnergyWh = 0;
  let knownNetBatteryEnergyWh = 0;
  let hasUnresolvedEnergy = false;
  let hasInvalidDuration = false;
  let hasWarning = false;

  entries.forEach((entry, index) => {
    const operatingCase = entry.operatingCase;
    const usageId = entry.usageId ?? operatingCase.operatingCaseId ?? `entry-${index + 1}`;
    const duration = entry.activeDurationHours;
    const entryIssues: string[] = [];
    const entryUnresolved: string[] = [];

    if (usageIds.has(usageId)) {
      entryIssues.push(`Duplicate usage ID: ${usageId}.`);
    }
    usageIds.add(usageId);

    if (!finite(duration) || duration < 0) {
      hasInvalidDuration = true;
      entryIssues.push(`${usageId}: activeDurationHours must be finite and non-negative.`);
    } else {
      modeledDurationHours += duration;
    }
    if (operatingCase.operatingCaseId === undefined) {
      entryIssues.push(`${usageId}: operating case ID is required for energy provenance.`);
    }
    if (operatingCase.severity === 'FAIL') {
      failedUsageIds.push(usageId);
      entryIssues.push(`${usageId}: operating case failed.`);
    }
    if (operatingCase.severity === 'WARNING') {
      hasWarning = true;
    }

    const hasResolvedPower =
      finite(operatingCase.netBatteryPowerW) &&
      validNonNegative(operatingCase.chargingSurplusW) &&
      validNonNegative(operatingCase.dischargeDeficitW);
    const directionallyConsistent =
      hasResolvedPower &&
      sameWithinTolerance(
        operatingCase.netBatteryPowerW!,
        operatingCase.chargingSurplusW! - operatingCase.dischargeDeficitW!,
      );

    let entryResult: UsageProfileEnergyEntryResult;
    if (
      entryIssues.length > 0 ||
      !validNonNegative(duration) ||
      !hasResolvedPower ||
      !directionallyConsistent
    ) {
      if (!hasResolvedPower || !directionallyConsistent) {
        entryUnresolved.push(
          `${usageId}: net battery power and directional power must all be resolved consistently.`,
        );
        unresolvedUsageIds.push(usageId);
        hasUnresolvedEnergy = true;
      }
      entryResult = {
        usageId,
        operatingCaseId: operatingCase.operatingCaseId,
        activeDurationHours: duration,
        energyStatus: 'unresolved',
        unresolvedFacts: [...operatingCase.unresolvedFacts, ...entryUnresolved],
        issues: [...operatingCase.issues, ...entryIssues],
        provenance: {
          operatingCaseId: operatingCase.operatingCaseId,
          activeDurationHours: duration,
          sourceNetBatteryPowerW: operatingCase.netBatteryPowerW,
          sourceChargingSurplusW: operatingCase.chargingSurplusW,
          sourceDischargeDeficitW: operatingCase.dischargeDeficitW,
        },
      };
    } else {
      const netEnergy = operatingCase.netBatteryPowerW! * duration;
      const chargingEnergy = operatingCase.chargingSurplusW! * duration;
      const dischargeEnergy = operatingCase.dischargeDeficitW! * duration;
      totalResolvedChargingEnergyWh += chargingEnergy;
      totalResolvedDischargeEnergyWh += dischargeEnergy;
      knownNetBatteryEnergyWh += netEnergy;
      entryResult = {
        usageId,
        operatingCaseId: operatingCase.operatingCaseId,
        activeDurationHours: duration,
        energyStatus: 'resolved',
        netBatteryPowerW: operatingCase.netBatteryPowerW,
        netBatteryEnergyWh: netEnergy,
        chargingEnergyWh: chargingEnergy,
        dischargeEnergyWh: dischargeEnergy,
        unresolvedFacts: [...operatingCase.unresolvedFacts],
        issues: [...operatingCase.issues],
        provenance: {
          operatingCaseId: operatingCase.operatingCaseId,
          activeDurationHours: duration,
          sourceNetBatteryPowerW: operatingCase.netBatteryPowerW,
          sourceChargingSurplusW: operatingCase.chargingSurplusW,
          sourceDischargeDeficitW: operatingCase.dischargeDeficitW,
        },
      };
      if (operatingCase.severity === 'CONDITIONAL') {
        hasUnresolvedEnergy = true;
      }
    }
    issues.push(
      ...entryResult.issues.map((issue) =>
        operatingCase.operatingCaseId && !issue.startsWith(`${operatingCase.operatingCaseId}:`)
          ? `${operatingCase.operatingCaseId}: ${issue}`
          : issue,
      ),
      ...entryResult.unresolvedFacts.map((fact) =>
        operatingCase.operatingCaseId && !fact.startsWith(`${operatingCase.operatingCaseId}:`)
          ? `${operatingCase.operatingCaseId}: ${fact}`
          : fact,
      ),
    );
    entryResults.push(entryResult);
  });

  if (finite(input.periodHours) && modeledDurationHours > input.periodHours + tolerance) {
    issues.push('Sum of activeDurationHours must not exceed periodHours.');
  }

  const temporalComplete =
    finite(input.periodHours) &&
    input.periodHours > 0 &&
    sameWithinTolerance(modeledDurationHours, input.periodHours);
  const unmodeledDurationHours =
    finite(input.periodHours) && input.periodHours > 0
      ? Math.max(input.periodHours - modeledDurationHours, 0)
      : 0;
  const hasFailure =
    invalidPeriod ||
    hasInvalidDuration ||
    modeledDurationHours > (finite(input.periodHours) ? input.periodHours : 0) + tolerance ||
    entryResults.some((entry) =>
      entry.issues.some((issue) => issue.includes('Duplicate usage ID')),
    ) ||
    failedUsageIds.length > 0 ||
    entryResults.some((entry) => entry.issues.some((issue) => issue.includes('operating case ID')));
  const severity: EngineeringSeverity = hasFailure
    ? 'FAIL'
    : hasUnresolvedEnergy || !temporalComplete
      ? 'CONDITIONAL'
      : hasWarning
        ? 'WARNING'
        : 'PASS';
  const canProveCompleteEnergy = severity !== 'FAIL' && temporalComplete && !hasUnresolvedEnergy;

  return {
    profileId: input.profileId,
    severity,
    code:
      severity === 'FAIL'
        ? 'usage_profile_energy.failed'
        : severity === 'CONDITIONAL'
          ? 'usage_profile_energy.unresolved'
          : severity === 'WARNING'
            ? 'usage_profile_energy.warning'
            : 'usage_profile_energy.pass',
    message:
      severity === 'FAIL'
        ? 'Usage profile energy evaluation failed.'
        : severity === 'CONDITIONAL'
          ? 'Usage profile retains known energy but cannot prove a complete result.'
          : severity === 'WARNING'
            ? 'Usage profile energy is resolved with upstream guidance warnings.'
            : 'Usage profile energy is fully resolved.',
    periodHours: input.periodHours,
    modeledDurationHours,
    unmodeledDurationHours,
    temporalCoverage: temporalComplete ? 'complete' : 'partial',
    temporalCoverageFraction:
      finite(input.periodHours) && input.periodHours > 0
        ? modeledDurationHours / input.periodHours
        : undefined,
    totalResolvedChargingEnergyWh,
    totalResolvedDischargeEnergyWh,
    knownNetBatteryEnergyWh,
    ...(canProveCompleteEnergy ? { profileNetBatteryEnergyWh: knownNetBatteryEnergyWh } : {}),
    unresolvedUsageIds: [...new Set(unresolvedUsageIds)],
    failedUsageIds: [...new Set(failedUsageIds)],
    entries: entryResults,
    issues: [...new Set(issues)],
    provenance: {
      periodHours: input.periodHours,
      modeledDurationHours,
      energyBasis: 'resolved operating-case battery-side rates',
    },
  };
};
