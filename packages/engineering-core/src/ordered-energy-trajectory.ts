import type { EngineeringSeverity } from './battery-power.js';
import type { OperatingPowerBalanceResult } from './operating-power-balance.js';

export interface OrderedOperatingIntervalInput {
  readonly intervalId?: string;
  readonly operatingCase: OperatingPowerBalanceResult;
  readonly durationHours: number;
}

export interface OrderedEnergyTrajectoryInput {
  readonly trajectoryId?: string;
  /** Array order is execution order; intervals are never sorted or inferred from labels. */
  readonly intervals: readonly OrderedOperatingIntervalInput[];
}

export type OrderedIntervalEnergyStatus = 'resolved' | 'unresolved' | 'failed';

export interface OrderedEnergyTrajectoryIntervalResult {
  readonly sequenceIndex: number;
  readonly intervalId?: string;
  readonly operatingCaseId?: string;
  readonly durationHours: number;
  readonly sourceNetBatteryPowerW?: number;
  readonly netEnergyWh?: number;
  readonly chargingEnergyWh?: number;
  readonly dischargeEnergyWh?: number;
  readonly cumulativeEnergyWh?: number;
  readonly energyStatus: OrderedIntervalEnergyStatus;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly sequenceIndex: number;
    readonly intervalId?: string;
    readonly operatingCaseId?: string;
    readonly durationHours: number;
    readonly sourceNetBatteryPowerW?: number;
    readonly sourceChargingSurplusW?: number;
    readonly sourceDischargeDeficitW?: number;
  };
}

export interface OrderedEnergyTrajectoryResult {
  readonly trajectoryId?: string;
  readonly status: EngineeringSeverity;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly completeTrajectory: boolean;
  readonly intervalCount: number;
  readonly intervals: readonly OrderedEnergyTrajectoryIntervalResult[];
  readonly endingNetEnergyWh?: number;
  readonly minimumCumulativeEnergyWh?: number;
  readonly maximumCumulativeEnergyWh?: number;
  readonly maximumCumulativeDeficitWh?: number;
  readonly maximumCumulativeSurplusWh?: number;
  readonly unresolvedIntervalIds: readonly string[];
  readonly unresolvedIntervalIndexes: readonly number[];
  readonly failedIntervalIds: readonly string[];
  readonly failedIntervalIndexes: readonly number[];
  readonly issues: readonly string[];
}

const tolerance = 1e-9;
const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);
const nonNegative = (value: number | undefined): value is number => finite(value) && value >= 0;
const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

export const evaluateOrderedEnergyTrajectory = (
  input: OrderedEnergyTrajectoryInput,
): OrderedEnergyTrajectoryResult => {
  const intervals = input.intervals ?? [];
  const issues: string[] = [];
  const seenIntervalIds = new Set<string>();
  const duplicateIntervalIds = new Set<string>();
  const unresolvedIntervalIds: string[] = [];
  const unresolvedIntervalIndexes: number[] = [];
  const failedIntervalIds: string[] = [];
  const failedIntervalIndexes: number[] = [];
  const results: OrderedEnergyTrajectoryIntervalResult[] = [];
  let cumulativeEnergyWh = 0;
  let minimumCumulativeEnergyWh = 0;
  let maximumCumulativeEnergyWh = 0;
  let hasInvalidInput = false;
  let hasUnresolvedInterval = false;
  let hasWarning = false;
  let prefixResolved = true;

  intervals.forEach((interval, index) => {
    const operatingCase = interval.operatingCase;
    const intervalLabel = interval.intervalId ?? `interval-${index + 1}`;
    const entryIssues: string[] = [...operatingCase.issues];
    const unresolvedFacts: string[] = [...operatingCase.unresolvedFacts];
    const durationValid = finite(interval.durationHours) && interval.durationHours >= 0;
    const hasPower =
      finite(operatingCase.netBatteryPowerW) &&
      nonNegative(operatingCase.chargingSurplusW) &&
      nonNegative(operatingCase.dischargeDeficitW);
    const directionallyConsistent =
      hasPower &&
      Math.abs(
        operatingCase.netBatteryPowerW! -
          (operatingCase.chargingSurplusW! - operatingCase.dischargeDeficitW!),
      ) <= tolerance;

    if (interval.intervalId !== undefined) {
      if (seenIntervalIds.has(interval.intervalId)) {
        duplicateIntervalIds.add(interval.intervalId);
      }
      seenIntervalIds.add(interval.intervalId);
    }
    if (!durationValid) {
      hasInvalidInput = true;
      entryIssues.push(`${intervalLabel}: durationHours must be finite and non-negative.`);
    }
    if (operatingCase.severity === 'WARNING') {
      hasWarning = true;
    }

    const failed = operatingCase.severity === 'FAIL';
    const resolved = durationValid && hasPower && directionallyConsistent && !failed;
    if (!hasPower || !directionallyConsistent) {
      unresolvedFacts.push(
        `${intervalLabel}: net battery power and directional power must all be resolved consistently.`,
      );
    }
    if (failed) {
      failedIntervalIndexes.push(index);
      if (interval.intervalId !== undefined) failedIntervalIds.push(interval.intervalId);
      entryIssues.push(`${intervalLabel}: operating case failed.`);
    }

    let netEnergyWh: number | undefined;
    let chargingEnergyWh: number | undefined;
    let dischargeEnergyWh: number | undefined;
    let intervalCumulativeEnergyWh: number | undefined;
    let energyStatus: OrderedIntervalEnergyStatus;

    if (failed) {
      energyStatus = 'failed';
      prefixResolved = false;
    } else if (!resolved) {
      energyStatus = 'unresolved';
      hasUnresolvedInterval = true;
      unresolvedIntervalIndexes.push(index);
      if (interval.intervalId !== undefined) unresolvedIntervalIds.push(interval.intervalId);
      prefixResolved = false;
    } else {
      energyStatus = 'resolved';
      netEnergyWh = normalizeZero(operatingCase.netBatteryPowerW! * interval.durationHours);
      chargingEnergyWh = normalizeZero(operatingCase.chargingSurplusW! * interval.durationHours);
      dischargeEnergyWh = normalizeZero(operatingCase.dischargeDeficitW! * interval.durationHours);
      if (prefixResolved) {
        cumulativeEnergyWh += netEnergyWh;
        intervalCumulativeEnergyWh = cumulativeEnergyWh;
        minimumCumulativeEnergyWh = Math.min(minimumCumulativeEnergyWh, cumulativeEnergyWh);
        maximumCumulativeEnergyWh = Math.max(maximumCumulativeEnergyWh, cumulativeEnergyWh);
      }
    }

    results.push({
      sequenceIndex: index,
      ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
      ...(operatingCase.operatingCaseId === undefined
        ? {}
        : { operatingCaseId: operatingCase.operatingCaseId }),
      durationHours: interval.durationHours,
      ...(operatingCase.netBatteryPowerW === undefined
        ? {}
        : { sourceNetBatteryPowerW: operatingCase.netBatteryPowerW }),
      ...(netEnergyWh === undefined ? {} : { netEnergyWh }),
      ...(chargingEnergyWh === undefined ? {} : { chargingEnergyWh }),
      ...(dischargeEnergyWh === undefined ? {} : { dischargeEnergyWh }),
      ...(intervalCumulativeEnergyWh === undefined
        ? {}
        : { cumulativeEnergyWh: intervalCumulativeEnergyWh }),
      energyStatus,
      unresolvedFacts,
      issues: entryIssues,
      provenance: {
        sequenceIndex: index,
        ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
        ...(operatingCase.operatingCaseId === undefined
          ? {}
          : { operatingCaseId: operatingCase.operatingCaseId }),
        durationHours: interval.durationHours,
        ...(operatingCase.netBatteryPowerW === undefined
          ? {}
          : { sourceNetBatteryPowerW: operatingCase.netBatteryPowerW }),
        ...(operatingCase.chargingSurplusW === undefined
          ? {}
          : { sourceChargingSurplusW: operatingCase.chargingSurplusW }),
        ...(operatingCase.dischargeDeficitW === undefined
          ? {}
          : { sourceDischargeDeficitW: operatingCase.dischargeDeficitW }),
      },
    });
  });

  for (const intervalId of [...duplicateIntervalIds].sort()) {
    hasInvalidInput = true;
    issues.push(`Duplicate interval ID: ${intervalId}.`);
  }
  for (const result of results) {
    issues.push(
      ...result.issues.map((issue) =>
        result.operatingCaseId && !issue.startsWith(`${result.operatingCaseId}:`)
          ? `${result.operatingCaseId}: ${issue}`
          : issue,
      ),
      ...result.unresolvedFacts.map((fact) =>
        result.operatingCaseId && !fact.startsWith(`${result.operatingCaseId}:`)
          ? `${result.operatingCaseId}: ${fact}`
          : fact,
      ),
    );
  }

  const hasFailedInterval = failedIntervalIndexes.length > 0;
  const completeTrajectory = !hasInvalidInput && !hasFailedInterval && !hasUnresolvedInterval;
  const severity: EngineeringSeverity =
    hasInvalidInput || hasFailedInterval
      ? 'FAIL'
      : hasUnresolvedInterval
        ? 'CONDITIONAL'
        : hasWarning
          ? 'WARNING'
          : 'PASS';
  const completeValues = completeTrajectory
    ? {
        endingNetEnergyWh: cumulativeEnergyWh,
        minimumCumulativeEnergyWh,
        maximumCumulativeEnergyWh,
        maximumCumulativeDeficitWh: Math.max(0, -minimumCumulativeEnergyWh),
        maximumCumulativeSurplusWh: Math.max(0, maximumCumulativeEnergyWh),
      }
    : {};

  return {
    trajectoryId: input.trajectoryId,
    status: severity,
    severity,
    code:
      severity === 'FAIL'
        ? 'ordered_energy_trajectory.failed'
        : severity === 'CONDITIONAL'
          ? 'ordered_energy_trajectory.unresolved'
          : severity === 'WARNING'
            ? 'ordered_energy_trajectory.warning'
            : 'ordered_energy_trajectory.pass',
    message:
      severity === 'FAIL'
        ? 'Ordered energy trajectory evaluation failed.'
        : severity === 'CONDITIONAL'
          ? 'Ordered energy trajectory retains known intervals but cannot prove a complete trajectory.'
          : severity === 'WARNING'
            ? 'Ordered energy trajectory is complete with upstream guidance warnings.'
            : 'Ordered energy trajectory is fully resolved.',
    completeTrajectory,
    intervalCount: intervals.length,
    intervals: results,
    ...completeValues,
    unresolvedIntervalIds: [...new Set(unresolvedIntervalIds)].sort(),
    unresolvedIntervalIndexes,
    failedIntervalIds: [...new Set(failedIntervalIds)].sort(),
    failedIntervalIndexes,
    issues: [...new Set(issues)],
  };
};
