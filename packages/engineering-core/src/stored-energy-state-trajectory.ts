import type { EngineeringSeverity } from './battery-power.js';

export interface StoredEnergyStateTrajectoryIntervalInput {
  readonly intervalId?: string;
  readonly sequenceIndex?: number;
  readonly operatingCaseId?: string;
  readonly durationHours?: number;
  readonly requestedNetEnergyWh?: number;
  readonly netEnergyWh?: number;
  readonly sourceNetBatteryPowerW?: number;
  readonly energyStatus?: 'resolved' | 'unresolved' | 'failed';
  readonly unresolvedFacts?: readonly string[];
  readonly issues?: readonly string[];
  readonly severity?: EngineeringSeverity;
}

export interface StoredEnergyStateTrajectoryInput {
  readonly trajectoryId?: string;
  readonly intervals: readonly StoredEnergyStateTrajectoryIntervalInput[];
  readonly startingStoredEnergyWh: number;
  readonly lowerStoredEnergyBoundWh: number;
  readonly upperStoredEnergyBoundWh: number;
}

export interface StoredEnergyStateTrajectoryIntervalResult {
  readonly sequenceIndex: number;
  readonly intervalId?: string;
  readonly operatingCaseId?: string;
  readonly durationHours?: number;
  readonly requestedNetEnergyWh?: number;
  readonly requestedChargingEnergyWh?: number;
  readonly requestedDischargeEnergyWh?: number;
  readonly storedGainWh?: number;
  readonly curtailedEnergyWh?: number;
  readonly deliveredFromStorageWh?: number;
  readonly unmetEnergyWh?: number;
  readonly startingStoredEnergyWh?: number;
  readonly endingStoredEnergyWh?: number;
  readonly energyStatus: 'resolved' | 'unresolved' | 'failed';
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance: {
    readonly sequenceIndex: number;
    readonly intervalId?: string;
    readonly operatingCaseId?: string;
    readonly durationHours?: number;
    readonly requestedNetEnergyWh?: number;
    readonly sourceNetBatteryPowerW?: number;
  };
}

export interface StoredEnergyStateTrajectoryResult {
  readonly trajectoryId?: string;
  readonly status: EngineeringSeverity;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly completeTrajectory: boolean;
  readonly intervalCount: number;
  readonly intervals: readonly StoredEnergyStateTrajectoryIntervalResult[];
  readonly startingStoredEnergyWh?: number;
  readonly lowerStoredEnergyBoundWh?: number;
  readonly upperStoredEnergyBoundWh?: number;
  readonly endingStoredEnergyWh?: number;
  readonly minimumStoredEnergyWh?: number;
  readonly maximumStoredEnergyWh?: number;
  readonly totalRequestedChargingEnergyWh?: number;
  readonly totalStoredChargingEnergyWh?: number;
  readonly totalCurtailedEnergyWh?: number;
  readonly totalRequestedDischargeEnergyWh?: number;
  readonly totalDeliveredDischargeEnergyWh?: number;
  readonly totalUnmetEnergyWh?: number;
  readonly unresolvedIntervalIds: readonly string[];
  readonly failedIntervalIds: readonly string[];
  readonly issues: readonly string[];
}

const tolerance = 1e-9;
const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);
const normalizeNumber = (value: number): number => {
  if (!Number.isFinite(value)) {
    return value;
  }
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const requestedNetEnergyFromInterval = (
  interval: StoredEnergyStateTrajectoryIntervalInput,
): number | undefined => {
  const directRequest = interval.requestedNetEnergyWh ?? interval.netEnergyWh;
  if (finite(directRequest)) {
    return normalizeNumber(directRequest);
  }

  return undefined;
};
const containsWarning = (issues: readonly string[] | undefined): boolean =>
  (issues ?? []).some((issue) => /warning/i.test(issue));

export const evaluateStoredEnergyStateTrajectory = (
  input: StoredEnergyStateTrajectoryInput,
): StoredEnergyStateTrajectoryResult => {
  const intervals = input.intervals ?? [];
  const issues: string[] = [];
  const unresolvedIntervalIds: string[] = [];
  const failedIntervalIds: string[] = [];
  const results: StoredEnergyStateTrajectoryIntervalResult[] = [];

  const lowerBound = input.lowerStoredEnergyBoundWh;
  const upperBound = input.upperStoredEnergyBoundWh;
  const startingStoredEnergyWh = input.startingStoredEnergyWh;

  const hasFiniteLower = finite(lowerBound);
  const hasFiniteUpper = finite(upperBound);
  const hasFiniteStart = finite(startingStoredEnergyWh);
  const boundsValid =
    hasFiniteLower &&
    hasFiniteUpper &&
    hasFiniteStart &&
    lowerBound >= 0 &&
    upperBound >= lowerBound &&
    startingStoredEnergyWh >= lowerBound - tolerance &&
    startingStoredEnergyWh <= upperBound + tolerance;

  if (!hasFiniteLower) {
    issues.push('lowerStoredEnergyBoundWh must be finite.');
  }
  if (!hasFiniteUpper) {
    issues.push('upperStoredEnergyBoundWh must be finite.');
  }
  if (!hasFiniteStart) {
    issues.push('startingStoredEnergyWh must be finite.');
  }
  if (hasFiniteLower && lowerBound < 0) {
    issues.push('lowerStoredEnergyBoundWh must be non-negative.');
  }
  if (hasFiniteLower && hasFiniteUpper && upperBound < lowerBound - tolerance) {
    issues.push(
      'upperStoredEnergyBoundWh must be greater than or equal to lowerStoredEnergyBoundWh.',
    );
  }
  if (
    hasFiniteLower &&
    hasFiniteUpper &&
    hasFiniteStart &&
    (startingStoredEnergyWh < lowerBound - tolerance ||
      startingStoredEnergyWh > upperBound + tolerance)
  ) {
    issues.push('startingStoredEnergyWh must lie within the inclusive storage bounds.');
  }

  if (!boundsValid) {
    return {
      trajectoryId: input.trajectoryId,
      status: 'FAIL',
      severity: 'FAIL',
      code: 'stored_energy_state_trajectory.failed',
      message: 'Stored-energy state trajectory validation failed.',
      completeTrajectory: false,
      intervalCount: intervals.length,
      intervals: results,
      unresolvedIntervalIds: [],
      failedIntervalIds: [],
      issues: [...new Set(issues)],
    };
  }

  let currentStoredEnergyWh = normalizeNumber(startingStoredEnergyWh);
  let minimumStoredEnergyWh = currentStoredEnergyWh;
  let maximumStoredEnergyWh = currentStoredEnergyWh;
  let totalRequestedChargingEnergyWh = 0;
  let totalStoredChargingEnergyWh = 0;
  let totalCurtailedEnergyWh = 0;
  let totalRequestedDischargeEnergyWh = 0;
  let totalDeliveredDischargeEnergyWh = 0;
  let totalUnmetEnergyWh = 0;
  let hasUnresolvedInterval = false;
  let hasFailedInterval = false;
  let hasWarning = false;
  let stateContinuityKnown = true;

  intervals.forEach((interval, index) => {
    const sequenceIndex = interval.sequenceIndex ?? index;
    const intervalLabel = interval.intervalId ?? `interval-${sequenceIndex + 1}`;
    const intervalIssues = [...(interval.issues ?? [])];
    const unresolvedFacts = [...(interval.unresolvedFacts ?? [])];
    const requestedNetEnergyWh = requestedNetEnergyFromInterval(interval);
    const requestedEnergyIsResolved = finite(requestedNetEnergyWh);
    const intervalSeverity = interval.severity ?? 'PASS';
    const explicitFailed = interval.energyStatus === 'failed' || intervalSeverity === 'FAIL';
    const explicitUnresolved =
      interval.energyStatus === 'unresolved' ||
      intervalSeverity === 'CONDITIONAL' ||
      (!requestedEnergyIsResolved && !explicitFailed);

    hasWarning ||= containsWarning(intervalIssues) || intervalSeverity === 'WARNING';

    if (explicitFailed) {
      hasFailedInterval = true;
      stateContinuityKnown = false;
      failedIntervalIds.push(interval.intervalId ?? intervalLabel);
      intervalIssues.push(`${intervalLabel}: interval energy evaluation failed.`);
      results.push({
        sequenceIndex,
        ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
        ...(interval.operatingCaseId === undefined
          ? {}
          : { operatingCaseId: interval.operatingCaseId }),
        durationHours: interval.durationHours,
        requestedNetEnergyWh: requestedEnergyIsResolved ? requestedNetEnergyWh : undefined,
        requestedChargingEnergyWh: 0,
        requestedDischargeEnergyWh: 0,
        storedGainWh: undefined,
        curtailedEnergyWh: undefined,
        deliveredFromStorageWh: undefined,
        unmetEnergyWh: undefined,
        startingStoredEnergyWh: undefined,
        endingStoredEnergyWh: undefined,
        energyStatus: 'failed',
        unresolvedFacts: [...new Set(unresolvedFacts)],
        issues: [...new Set(intervalIssues)],
        provenance: {
          sequenceIndex,
          ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
          ...(interval.operatingCaseId === undefined
            ? {}
            : { operatingCaseId: interval.operatingCaseId }),
          durationHours: interval.durationHours,
          requestedNetEnergyWh: requestedEnergyIsResolved ? requestedNetEnergyWh : undefined,
          sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
        },
      });
      return;
    }

    if (!stateContinuityKnown) {
      if (requestedEnergyIsResolved) {
        results.push({
          sequenceIndex,
          ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
          ...(interval.operatingCaseId === undefined
            ? {}
            : { operatingCaseId: interval.operatingCaseId }),
          durationHours: interval.durationHours,
          requestedNetEnergyWh,
          requestedChargingEnergyWh: Math.max(requestedNetEnergyWh!, 0),
          requestedDischargeEnergyWh: Math.max(-requestedNetEnergyWh!, 0),
          storedGainWh: undefined,
          curtailedEnergyWh: undefined,
          deliveredFromStorageWh: undefined,
          unmetEnergyWh: undefined,
          startingStoredEnergyWh: undefined,
          endingStoredEnergyWh: undefined,
          energyStatus: 'resolved',
          unresolvedFacts: [...new Set(unresolvedFacts)],
          issues: [...new Set(intervalIssues)],
          provenance: {
            sequenceIndex,
            ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
            ...(interval.operatingCaseId === undefined
              ? {}
              : { operatingCaseId: interval.operatingCaseId }),
            durationHours: interval.durationHours,
            requestedNetEnergyWh,
            sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
          },
        });
      } else {
        hasUnresolvedInterval = true;
        unresolvedIntervalIds.push(interval.intervalId ?? intervalLabel);
        unresolvedFacts.push(
          `${intervalLabel}: requested net energy cannot be resolved after a prior unresolved state interval.`,
        );
        results.push({
          sequenceIndex,
          ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
          ...(interval.operatingCaseId === undefined
            ? {}
            : { operatingCaseId: interval.operatingCaseId }),
          durationHours: interval.durationHours,
          requestedNetEnergyWh: undefined,
          requestedChargingEnergyWh: 0,
          requestedDischargeEnergyWh: 0,
          storedGainWh: undefined,
          curtailedEnergyWh: undefined,
          deliveredFromStorageWh: undefined,
          unmetEnergyWh: undefined,
          startingStoredEnergyWh: undefined,
          endingStoredEnergyWh: undefined,
          energyStatus: 'unresolved',
          unresolvedFacts: [...new Set(unresolvedFacts)],
          issues: [...new Set(intervalIssues)],
          provenance: {
            sequenceIndex,
            ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
            ...(interval.operatingCaseId === undefined
              ? {}
              : { operatingCaseId: interval.operatingCaseId }),
            durationHours: interval.durationHours,
            requestedNetEnergyWh: undefined,
            sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
          },
        });
      }
      return;
    }

    if (explicitUnresolved || !requestedEnergyIsResolved) {
      hasUnresolvedInterval = true;
      stateContinuityKnown = false;
      unresolvedIntervalIds.push(interval.intervalId ?? intervalLabel);
      unresolvedFacts.push(
        `${intervalLabel}: requested net energy is unresolved, so the absolute stored-energy state cannot be proven past this interval.`,
      );
      results.push({
        sequenceIndex,
        ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
        ...(interval.operatingCaseId === undefined
          ? {}
          : { operatingCaseId: interval.operatingCaseId }),
        durationHours: interval.durationHours,
        requestedNetEnergyWh: requestedEnergyIsResolved ? requestedNetEnergyWh : undefined,
        requestedChargingEnergyWh: 0,
        requestedDischargeEnergyWh: 0,
        storedGainWh: undefined,
        curtailedEnergyWh: undefined,
        deliveredFromStorageWh: undefined,
        unmetEnergyWh: undefined,
        startingStoredEnergyWh: undefined,
        endingStoredEnergyWh: undefined,
        energyStatus: 'unresolved',
        unresolvedFacts: [...new Set(unresolvedFacts)],
        issues: [...new Set(intervalIssues)],
        provenance: {
          sequenceIndex,
          ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
          ...(interval.operatingCaseId === undefined
            ? {}
            : { operatingCaseId: interval.operatingCaseId }),
          durationHours: interval.durationHours,
          requestedNetEnergyWh: requestedEnergyIsResolved ? requestedNetEnergyWh : undefined,
          sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
        },
      });
      return;
    }

    const requestedEnergy = requestedNetEnergyWh!;
    const startingStoredEnergyWhForInterval = currentStoredEnergyWh;
    const requestedChargingEnergyWh = Math.max(requestedEnergy, 0);
    const requestedDischargeEnergyWh = Math.max(-requestedEnergy, 0);

    let storedGainWh: number | undefined;
    let curtailedEnergyWh: number | undefined;
    let deliveredFromStorageWh: number | undefined;
    let unmetEnergyWh: number | undefined;
    let endingStoredEnergyWhForInterval = currentStoredEnergyWh;

    if (requestedEnergy > tolerance) {
      const headroomWh = upperBound - currentStoredEnergyWh;
      const storedGain = Math.min(requestedChargingEnergyWh, Math.max(headroomWh, 0));
      storedGainWh = normalizeNumber(storedGain);
      curtailedEnergyWh = normalizeNumber(requestedChargingEnergyWh - storedGainWh);
      endingStoredEnergyWhForInterval = normalizeNumber(currentStoredEnergyWh + storedGainWh);
    } else if (requestedEnergy < -tolerance) {
      const availableDrawableWh = Math.max(currentStoredEnergyWh - lowerBound, 0);
      const dischargeRequestWh = requestedDischargeEnergyWh;
      const delivered = Math.min(dischargeRequestWh, availableDrawableWh);
      deliveredFromStorageWh = normalizeNumber(delivered);
      unmetEnergyWh = normalizeNumber(dischargeRequestWh - deliveredFromStorageWh);
      endingStoredEnergyWhForInterval = normalizeNumber(
        currentStoredEnergyWh - deliveredFromStorageWh,
      );
    }

    if (
      endingStoredEnergyWhForInterval < lowerBound - tolerance ||
      endingStoredEnergyWhForInterval > upperBound + tolerance
    ) {
      hasFailedInterval = true;
      failedIntervalIds.push(interval.intervalId ?? intervalLabel);
      intervalIssues.push(
        `${intervalLabel}: storage state left the declared storage bounds after applying the requested interval energy.`,
      );
      results.push({
        sequenceIndex,
        ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
        ...(interval.operatingCaseId === undefined
          ? {}
          : { operatingCaseId: interval.operatingCaseId }),
        durationHours: interval.durationHours,
        requestedNetEnergyWh,
        requestedChargingEnergyWh,
        requestedDischargeEnergyWh,
        storedGainWh,
        curtailedEnergyWh,
        deliveredFromStorageWh,
        unmetEnergyWh,
        startingStoredEnergyWh: startingStoredEnergyWhForInterval,
        endingStoredEnergyWh: endingStoredEnergyWhForInterval,
        energyStatus: 'failed',
        unresolvedFacts: [...new Set(unresolvedFacts)],
        issues: [...new Set(intervalIssues)],
        provenance: {
          sequenceIndex,
          ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
          ...(interval.operatingCaseId === undefined
            ? {}
            : { operatingCaseId: interval.operatingCaseId }),
          durationHours: interval.durationHours,
          requestedNetEnergyWh,
          sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
        },
      });
      return;
    }

    currentStoredEnergyWh = endingStoredEnergyWhForInterval;
    minimumStoredEnergyWh = Math.min(minimumStoredEnergyWh, currentStoredEnergyWh);
    maximumStoredEnergyWh = Math.max(maximumStoredEnergyWh, currentStoredEnergyWh);

    totalRequestedChargingEnergyWh += requestedChargingEnergyWh;
    totalStoredChargingEnergyWh += storedGainWh ?? 0;
    totalCurtailedEnergyWh += curtailedEnergyWh ?? 0;
    totalRequestedDischargeEnergyWh += requestedDischargeEnergyWh;
    totalDeliveredDischargeEnergyWh += deliveredFromStorageWh ?? 0;
    totalUnmetEnergyWh += unmetEnergyWh ?? 0;

    results.push({
      sequenceIndex,
      ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
      ...(interval.operatingCaseId === undefined
        ? {}
        : { operatingCaseId: interval.operatingCaseId }),
      durationHours: interval.durationHours,
      requestedNetEnergyWh,
      requestedChargingEnergyWh,
      requestedDischargeEnergyWh,
      storedGainWh,
      curtailedEnergyWh,
      deliveredFromStorageWh,
      unmetEnergyWh,
      startingStoredEnergyWh: startingStoredEnergyWhForInterval,
      endingStoredEnergyWh: endingStoredEnergyWhForInterval,
      energyStatus: 'resolved',
      unresolvedFacts: [...new Set(unresolvedFacts)],
      issues: [...new Set(intervalIssues)],
      provenance: {
        sequenceIndex,
        ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
        ...(interval.operatingCaseId === undefined
          ? {}
          : { operatingCaseId: interval.operatingCaseId }),
        durationHours: interval.durationHours,
        requestedNetEnergyWh,
        sourceNetBatteryPowerW: interval.sourceNetBatteryPowerW,
      },
    });
  });

  for (const result of results) {
    issues.push(...result.issues, ...result.unresolvedFacts);
  }

  const hasUnmetDischarge = totalUnmetEnergyWh > tolerance;
  const finalStoredEnergyWh = stateContinuityKnown
    ? normalizeNumber(currentStoredEnergyWh)
    : undefined;
  const globalEnding = finalStoredEnergyWh;
  const globalMinimum = stateContinuityKnown ? normalizeNumber(minimumStoredEnergyWh) : undefined;
  const globalMaximum = stateContinuityKnown ? normalizeNumber(maximumStoredEnergyWh) : undefined;
  const completeTrajectory =
    stateContinuityKnown && !hasFailedInterval && !hasUnresolvedInterval && !hasUnmetDischarge;

  const severity: EngineeringSeverity =
    hasFailedInterval || hasUnmetDischarge
      ? 'FAIL'
      : hasUnresolvedInterval
        ? 'CONDITIONAL'
        : hasWarning
          ? 'WARNING'
          : 'PASS';

  return {
    trajectoryId: input.trajectoryId,
    status: severity,
    severity,
    code:
      severity === 'FAIL'
        ? 'stored_energy_state_trajectory.failed'
        : severity === 'CONDITIONAL'
          ? 'stored_energy_state_trajectory.unresolved'
          : severity === 'WARNING'
            ? 'stored_energy_state_trajectory.warning'
            : 'stored_energy_state_trajectory.pass',
    message:
      severity === 'FAIL'
        ? hasUnmetDischarge
          ? 'Selected storage-state trajectory fails because requested discharge exceeds the supplied lower bound.'
          : 'Stored-energy state trajectory validation failed.'
        : severity === 'CONDITIONAL'
          ? 'Stored-energy state trajectory retains known facts but cannot prove a complete result.'
          : severity === 'WARNING'
            ? 'Stored-energy state trajectory is fully resolved with upstream warnings.'
            : 'Stored-energy state trajectory is fully resolved.',
    completeTrajectory,
    intervalCount: intervals.length,
    intervals: results,
    startingStoredEnergyWh: normalizeNumber(startingStoredEnergyWh),
    lowerStoredEnergyBoundWh: normalizeNumber(lowerBound),
    upperStoredEnergyBoundWh: normalizeNumber(upperBound),
    endingStoredEnergyWh: globalEnding,
    minimumStoredEnergyWh: globalMinimum,
    maximumStoredEnergyWh: globalMaximum,
    totalRequestedChargingEnergyWh: normalizeNumber(totalRequestedChargingEnergyWh),
    totalStoredChargingEnergyWh: normalizeNumber(totalStoredChargingEnergyWh),
    totalCurtailedEnergyWh: normalizeNumber(totalCurtailedEnergyWh),
    totalRequestedDischargeEnergyWh: normalizeNumber(totalRequestedDischargeEnergyWh),
    totalDeliveredDischargeEnergyWh: normalizeNumber(totalDeliveredDischargeEnergyWh),
    totalUnmetEnergyWh: normalizeNumber(totalUnmetEnergyWh),
    unresolvedIntervalIds: [...new Set(unresolvedIntervalIds)],
    failedIntervalIds: [...new Set(failedIntervalIds)],
    issues: [...new Set(issues)],
  };
};
