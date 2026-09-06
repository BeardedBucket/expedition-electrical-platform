import type { EngineeringIssue, EngineeringSeverity } from './battery-power.js';
import type {
  StoredEnergyStateTrajectoryIntervalResult,
  StoredEnergyStateTrajectoryResult,
} from './stored-energy-state-trajectory.js';

const tolerance = 1e-9;

export type StoredEnergyReserveState = 'above-reserve' | 'at-reserve' | 'below-reserve';

export interface StoredEnergySocObservationInput {
  readonly storedEnergyWh: number;
  readonly lowerStoredEnergyBoundWh: number;
  readonly upperStoredEnergyBoundWh: number;
  readonly desiredReserveSocPercent?: number;
}

export interface StoredEnergySocObservation {
  readonly storedEnergyWh: number;
  readonly lowerStoredEnergyBoundWh: number;
  readonly upperStoredEnergyBoundWh: number;
  readonly usableWindowSocFraction?: number;
  readonly usableWindowSocPercent?: number;
  readonly desiredReserveSocPercent?: number;
  readonly desiredReserveStoredEnergyWh?: number;
  readonly reserveMarginPercentagePoints?: number;
  readonly reserveMarginWh?: number;
  readonly reserveState?: StoredEnergyReserveState;
  readonly basis: 'calculated-usable-window';
}

export interface StoredEnergySocObservationResult extends StoredEnergySocObservation {
  readonly severity: EngineeringSeverity;
  readonly status: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly issues: readonly EngineeringIssue[];
  readonly unresolvedFacts: readonly string[];
  readonly provenance: {
    readonly formula: string;
    readonly basis: 'calculated-usable-window';
  };
}

export interface StoredEnergyTrajectorySocObservationInput {
  readonly desiredReserveSocPercent?: number;
}

export interface StoredEnergyTrajectorySocIntervalObservation {
  readonly sequenceIndex: number;
  readonly intervalId?: string;
  readonly startingSoc?: StoredEnergySocObservation;
  readonly endingSoc?: StoredEnergySocObservation;
}

export interface StoredEnergyTrajectorySocObservationResult {
  readonly trajectoryId?: string;
  readonly severity: EngineeringSeverity;
  readonly status: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly startingSoc?: StoredEnergySocObservation;
  readonly endingSoc?: StoredEnergySocObservation;
  readonly minimumSoc?: StoredEnergySocObservation;
  readonly maximumSoc?: StoredEnergySocObservation;
  readonly intervals: readonly StoredEnergyTrajectorySocIntervalObservation[];
  readonly desiredReserveSocPercent?: number;
  readonly minimumReserveMarginPercentagePoints?: number;
  readonly minimumReserveMarginWh?: number;
  readonly everBelowDesiredReserve?: boolean;
  readonly belowReserveIntervalIds?: readonly string[];
  readonly reserveCrossingIntervalIds?: readonly string[];
  readonly issues: readonly EngineeringIssue[];
  readonly unresolvedFacts: readonly string[];
  readonly provenance: {
    readonly trajectoryId?: string;
    readonly basis: 'calculated-usable-window';
  };
}

const finite = (value: number): boolean => Number.isFinite(value);
const normalize = (value: number): number => {
  if (!finite(value)) return value;
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const issue = (code: string, message: string, severity: EngineeringSeverity): EngineeringIssue => ({
  severity,
  code,
  message,
});

const stateFromResult = (result: StoredEnergySocObservationResult): StoredEnergySocObservation => ({
  storedEnergyWh: result.storedEnergyWh,
  lowerStoredEnergyBoundWh: result.lowerStoredEnergyBoundWh,
  upperStoredEnergyBoundWh: result.upperStoredEnergyBoundWh,
  usableWindowSocFraction: result.usableWindowSocFraction,
  usableWindowSocPercent: result.usableWindowSocPercent,
  desiredReserveSocPercent: result.desiredReserveSocPercent,
  desiredReserveStoredEnergyWh: result.desiredReserveStoredEnergyWh,
  reserveMarginPercentagePoints: result.reserveMarginPercentagePoints,
  reserveMarginWh: result.reserveMarginWh,
  reserveState: result.reserveState,
  basis: result.basis,
});

export const evaluateStoredEnergySocObservation = (
  input: StoredEnergySocObservationInput,
): StoredEnergySocObservationResult => {
  const storedEnergyWh = normalize(input.storedEnergyWh);
  const lowerStoredEnergyBoundWh = normalize(input.lowerStoredEnergyBoundWh);
  const upperStoredEnergyBoundWh = normalize(input.upperStoredEnergyBoundWh);
  const desiredReserveSocPercent = input.desiredReserveSocPercent;
  const issues: EngineeringIssue[] = [];
  const unresolvedFacts: string[] = [];

  if (!finite(storedEnergyWh)) {
    issues.push(
      issue('soc_reserve.invalid_stored_energy_wh', 'storedEnergyWh must be finite.', 'FAIL'),
    );
  }
  if (!finite(lowerStoredEnergyBoundWh) || lowerStoredEnergyBoundWh < 0) {
    issues.push(
      issue(
        'soc_reserve.invalid_lower_bound_wh',
        'lowerStoredEnergyBoundWh must be finite and non-negative.',
        'FAIL',
      ),
    );
  }
  if (!finite(upperStoredEnergyBoundWh)) {
    issues.push(
      issue(
        'soc_reserve.invalid_upper_bound_wh',
        'upperStoredEnergyBoundWh must be finite.',
        'FAIL',
      ),
    );
  }
  if (
    finite(lowerStoredEnergyBoundWh) &&
    finite(upperStoredEnergyBoundWh) &&
    upperStoredEnergyBoundWh < lowerStoredEnergyBoundWh - tolerance
  ) {
    issues.push(
      issue(
        'soc_reserve.invalid_bounds',
        'upperStoredEnergyBoundWh must be greater than or equal to lowerStoredEnergyBoundWh.',
        'FAIL',
      ),
    );
  }
  if (
    finite(storedEnergyWh) &&
    finite(lowerStoredEnergyBoundWh) &&
    finite(upperStoredEnergyBoundWh) &&
    (storedEnergyWh < lowerStoredEnergyBoundWh - tolerance ||
      storedEnergyWh > upperStoredEnergyBoundWh + tolerance)
  ) {
    issues.push(
      issue(
        'soc_reserve.stored_energy_out_of_bounds',
        'storedEnergyWh must lie within the inclusive storage bounds.',
        'FAIL',
      ),
    );
  }
  if (
    desiredReserveSocPercent !== undefined &&
    (!finite(desiredReserveSocPercent) ||
      desiredReserveSocPercent < 0 ||
      desiredReserveSocPercent > 100)
  ) {
    issues.push(
      issue(
        'soc_reserve.invalid_desired_reserve_percent',
        'desiredReserveSocPercent must be finite and between 0 and 100 inclusive.',
        'FAIL',
      ),
    );
  }

  const base = {
    storedEnergyWh,
    lowerStoredEnergyBoundWh,
    upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
    basis: 'calculated-usable-window' as const,
    provenance: {
      formula:
        '(storedEnergyWh - lowerStoredEnergyBoundWh) / (upperStoredEnergyBoundWh - lowerStoredEnergyBoundWh)',
      basis: 'calculated-usable-window' as const,
    },
  };

  if (issues.length > 0) {
    return {
      ...base,
      severity: 'FAIL',
      status: 'FAIL',
      code: 'soc_reserve.invalid_input',
      message: 'Stored-energy SOC observation input validation failed.',
      usableWindowSocFraction: undefined,
      usableWindowSocPercent: undefined,
      desiredReserveStoredEnergyWh: undefined,
      reserveMarginPercentagePoints: undefined,
      reserveMarginWh: undefined,
      reserveState: undefined,
      issues,
      unresolvedFacts,
    };
  }

  const usableWindowWh = upperStoredEnergyBoundWh - lowerStoredEnergyBoundWh;
  if (Math.abs(usableWindowWh) <= tolerance) {
    const zeroWidthMessage = 'A zero-width stored-energy window cannot produce a normalized SOC.';
    unresolvedFacts.push(zeroWidthMessage);
    return {
      ...base,
      severity: 'CONDITIONAL',
      status: 'CONDITIONAL',
      code: 'soc_reserve.zero_width_window',
      message:
        'Stored energy is valid, but normalized usable-window SOC is undefined for a zero-width window.',
      usableWindowSocFraction: undefined,
      usableWindowSocPercent: undefined,
      desiredReserveStoredEnergyWh: undefined,
      reserveMarginPercentagePoints: undefined,
      reserveMarginWh: undefined,
      reserveState: undefined,
      issues: [issue('soc_reserve.zero_width_window', zeroWidthMessage, 'CONDITIONAL')],
      unresolvedFacts,
    };
  }

  const usableWindowSocFraction = normalize(
    (storedEnergyWh - lowerStoredEnergyBoundWh) / usableWindowWh,
  );
  const usableWindowSocPercent = normalize(usableWindowSocFraction * 100);
  const desiredReserveStoredEnergyWh =
    desiredReserveSocPercent === undefined
      ? undefined
      : normalize(lowerStoredEnergyBoundWh + (desiredReserveSocPercent / 100) * usableWindowWh);
  const reserveMarginPercentagePoints =
    desiredReserveSocPercent === undefined
      ? undefined
      : normalize(usableWindowSocPercent - desiredReserveSocPercent);
  const reserveMarginWh =
    desiredReserveStoredEnergyWh === undefined
      ? undefined
      : normalize(storedEnergyWh - desiredReserveStoredEnergyWh);
  const reserveState =
    reserveMarginPercentagePoints === undefined
      ? undefined
      : Math.abs(reserveMarginPercentagePoints) <= tolerance
        ? 'at-reserve'
        : reserveMarginPercentagePoints > 0
          ? 'above-reserve'
          : 'below-reserve';

  return {
    ...base,
    usableWindowSocFraction,
    usableWindowSocPercent,
    desiredReserveStoredEnergyWh,
    reserveMarginPercentagePoints,
    reserveMarginWh,
    reserveState,
    severity: 'PASS',
    status: 'PASS',
    code: 'soc_reserve.pass',
    message: 'Stored-energy SOC observation is resolved.',
    issues: [],
    unresolvedFacts: [],
  };
};

const stateObservation = (
  storedEnergyWh: number | undefined,
  lowerStoredEnergyBoundWh: number | undefined,
  upperStoredEnergyBoundWh: number | undefined,
  desiredReserveSocPercent: number | undefined,
): StoredEnergySocObservation | undefined => {
  if (
    storedEnergyWh === undefined ||
    lowerStoredEnergyBoundWh === undefined ||
    upperStoredEnergyBoundWh === undefined
  ) {
    return undefined;
  }
  const result = evaluateStoredEnergySocObservation({
    storedEnergyWh,
    lowerStoredEnergyBoundWh,
    upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
  });
  return result.severity === 'FAIL' ? undefined : stateFromResult(result);
};

const intervalObservation = (
  interval: StoredEnergyStateTrajectoryIntervalResult,
  lower: number | undefined,
  upper: number | undefined,
  desiredReserveSocPercent: number | undefined,
): StoredEnergyTrajectorySocIntervalObservation => ({
  sequenceIndex: interval.sequenceIndex,
  ...(interval.intervalId === undefined ? {} : { intervalId: interval.intervalId }),
  startingSoc: stateObservation(
    interval.startingStoredEnergyWh,
    lower,
    upper,
    desiredReserveSocPercent,
  ),
  endingSoc: stateObservation(
    interval.endingStoredEnergyWh,
    lower,
    upper,
    desiredReserveSocPercent,
  ),
});

export const observeStoredEnergyTrajectorySoc = (
  trajectory: StoredEnergyStateTrajectoryResult,
  input: StoredEnergyTrajectorySocObservationInput = {},
): StoredEnergyTrajectorySocObservationResult => {
  const desiredReserveSocPercent = input.desiredReserveSocPercent;
  const intervals = trajectory.intervals.map((interval) =>
    intervalObservation(
      interval,
      trajectory.lowerStoredEnergyBoundWh,
      trajectory.upperStoredEnergyBoundWh,
      desiredReserveSocPercent,
    ),
  );
  const startingSoc = stateObservation(
    trajectory.startingStoredEnergyWh,
    trajectory.lowerStoredEnergyBoundWh,
    trajectory.upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
  );
  const endingSoc = stateObservation(
    trajectory.endingStoredEnergyWh,
    trajectory.lowerStoredEnergyBoundWh,
    trajectory.upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
  );
  const minimumSoc = stateObservation(
    trajectory.minimumStoredEnergyWh,
    trajectory.lowerStoredEnergyBoundWh,
    trajectory.upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
  );
  const maximumSoc = stateObservation(
    trajectory.maximumStoredEnergyWh,
    trajectory.lowerStoredEnergyBoundWh,
    trajectory.upperStoredEnergyBoundWh,
    desiredReserveSocPercent,
  );
  const knownStates = [
    startingSoc,
    endingSoc,
    ...intervals.flatMap((entry) => [entry.startingSoc, entry.endingSoc]),
  ].filter((entry): entry is StoredEnergySocObservation => entry !== undefined);
  const reserveStates = knownStates.filter(
    (entry) => entry.reserveMarginPercentagePoints !== undefined,
  );
  const belowReserveIntervalIds = intervals
    .filter((entry) =>
      [entry.startingSoc, entry.endingSoc].some((soc) => soc?.reserveState === 'below-reserve'),
    )
    .map((entry) => entry.intervalId ?? `interval-${entry.sequenceIndex + 1}`);
  const everBelowDesiredReserve =
    desiredReserveSocPercent === undefined
      ? undefined
      : knownStates.some((entry) => entry.reserveState === 'below-reserve');
  const minimumReserveMarginPercentagePoints =
    reserveStates.length === 0
      ? undefined
      : Math.min(...reserveStates.map((entry) => entry.reserveMarginPercentagePoints!));
  const minimumReserveMarginWh =
    reserveStates.length === 0
      ? undefined
      : Math.min(...reserveStates.map((entry) => entry.reserveMarginWh!));
  const observationIssues: EngineeringIssue[] = [];
  const unresolvedFacts = [...trajectory.issues];
  let severity = trajectory.severity;
  if (
    severity === 'PASS' &&
    trajectory.lowerStoredEnergyBoundWh === trajectory.upperStoredEnergyBoundWh
  ) {
    severity = 'CONDITIONAL';
    observationIssues.push(
      issue(
        'soc_reserve.zero_width_window',
        'Normalized SOC is unresolved because the trajectory storage window has zero width.',
        'CONDITIONAL',
      ),
    );
  }

  return {
    trajectoryId: trajectory.trajectoryId,
    severity,
    status: severity,
    code: `soc_reserve.trajectory_${severity.toLowerCase()}`,
    message: 'Stored-energy trajectory SOC observation preserves the upstream trajectory state.',
    startingSoc,
    endingSoc,
    minimumSoc,
    maximumSoc,
    intervals,
    desiredReserveSocPercent,
    minimumReserveMarginPercentagePoints,
    minimumReserveMarginWh,
    everBelowDesiredReserve,
    belowReserveIntervalIds:
      desiredReserveSocPercent === undefined ? undefined : belowReserveIntervalIds,
    reserveCrossingIntervalIds:
      desiredReserveSocPercent === undefined ? undefined : belowReserveIntervalIds,
    issues: observationIssues,
    unresolvedFacts,
    provenance: {
      trajectoryId: trajectory.trajectoryId,
      basis: 'calculated-usable-window',
    },
  };
};
