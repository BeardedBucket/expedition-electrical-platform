import type { EngineeringSeverity } from './battery-power.js';

export interface VariableSourceEnergyContributionInput {
  readonly sourceId: string;
  readonly energyWh?: number;
  readonly batterySidePowerW?: number;
  readonly durationHours?: number;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface VariableSourceEnergyIntervalInput {
  readonly intervalId: string;
  readonly contributions: readonly VariableSourceEnergyContributionInput[];
}

export interface VariableSourceEnergySequenceInput {
  readonly sequenceId?: string;
  readonly intervals: readonly VariableSourceEnergyIntervalInput[];
}

export type VariableSourceEnergyStatus = 'resolved' | 'unresolved' | 'failed';

export interface VariableSourceEnergyContributionResult {
  readonly sourceId: string;
  readonly energyWh?: number;
  readonly resolvedEnergyWh?: number;
  readonly batterySidePowerW?: number;
  readonly durationHours?: number;
  readonly energyStatus: VariableSourceEnergyStatus;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface VariableSourceEnergyIntervalResult {
  readonly sequenceIndex: number;
  readonly intervalId: string;
  readonly sourceContributions: readonly VariableSourceEnergyContributionResult[];
  readonly knownSourceEnergyWh: number;
  readonly totalSourceEnergyWh?: number;
  readonly energyStatus: VariableSourceEnergyStatus;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
}

export interface VariableSourceEnergySequenceResult {
  readonly sequenceId?: string;
  readonly severity: EngineeringSeverity;
  readonly status: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly completeSequence: boolean;
  readonly intervalCount: number;
  readonly intervals: readonly VariableSourceEnergyIntervalResult[];
  readonly knownSourceEnergyWh: number;
  readonly totalSourceEnergyWh?: number;
  readonly unresolvedIntervalIds: readonly string[];
  readonly failedIntervalIds: readonly string[];
  readonly issues: readonly string[];
}

export interface VariableSourceAndLoadEnergyInput {
  readonly sourceInterval: VariableSourceEnergyIntervalResult;
  /** Load energy uses the existing net-energy sign convention: consumption is negative. */
  readonly loadEnergyWh?: number;
}

export interface VariableSourceAndLoadEnergyResult {
  readonly intervalId: string;
  readonly severity: EngineeringSeverity;
  readonly status: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
  readonly sourceEnergyWh?: number;
  readonly loadEnergyWh?: number;
  readonly netBatteryEnergyWh?: number;
  readonly unresolvedFacts: readonly string[];
  readonly issues: readonly string[];
}

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const normalizeZero = (value: number): number => (Object.is(value, -0) ? 0 : value);

const contributionResult = (
  contribution: VariableSourceEnergyContributionInput,
  values: Omit<
    VariableSourceEnergyContributionResult,
    'sourceId' | 'provenance' | 'energyWh' | 'batterySidePowerW' | 'durationHours'
  >,
): VariableSourceEnergyContributionResult => ({
  sourceId: contribution.sourceId,
  ...(contribution.energyWh === undefined ? {} : { energyWh: contribution.energyWh }),
  ...(contribution.batterySidePowerW === undefined
    ? {}
    : { batterySidePowerW: contribution.batterySidePowerW }),
  ...(contribution.durationHours === undefined
    ? {}
    : { durationHours: contribution.durationHours }),
  ...(contribution.provenance === undefined ? {} : { provenance: contribution.provenance }),
  ...values,
});

const evaluateContribution = (
  contribution: VariableSourceEnergyContributionInput,
): VariableSourceEnergyContributionResult => {
  const hasEnergy = contribution.energyWh !== undefined;
  const hasPower = contribution.batterySidePowerW !== undefined;
  const issues: string[] = [];
  const unresolvedFacts: string[] = [];

  if (contribution.sourceId.length === 0) {
    issues.push('sourceId must be a non-empty identifier.');
  }
  if (hasEnergy && hasPower) {
    issues.push('Exactly one of energyWh or batterySidePowerW may be supplied.');
  }
  if (hasEnergy && (!finite(contribution.energyWh) || contribution.energyWh < 0)) {
    issues.push('energyWh must be finite and non-negative.');
  }
  if (hasPower && (!finite(contribution.batterySidePowerW) || contribution.batterySidePowerW < 0)) {
    issues.push('batterySidePowerW must be finite and non-negative.');
  }
  if (
    contribution.durationHours !== undefined &&
    (!finite(contribution.durationHours) || contribution.durationHours < 0)
  ) {
    issues.push('durationHours must be finite and non-negative.');
  }

  if (issues.length > 0) {
    return contributionResult(contribution, {
      energyStatus: 'failed',
      unresolvedFacts,
      issues,
    });
  }
  if (!hasEnergy && !hasPower) {
    unresolvedFacts.push('Source contribution energy is unresolved; it is not zero.');
    return contributionResult(contribution, {
      energyStatus: 'unresolved',
      unresolvedFacts,
      issues,
    });
  }
  if (hasPower && contribution.durationHours === undefined) {
    unresolvedFacts.push('durationHours is required when batterySidePowerW is supplied.');
    return contributionResult(contribution, {
      energyStatus: 'unresolved',
      unresolvedFacts,
      issues,
    });
  }
  if (!hasPower && contribution.durationHours !== undefined) {
    issues.push('durationHours is only valid with batterySidePowerW.');
    return contributionResult(contribution, {
      energyStatus: 'failed',
      unresolvedFacts,
      issues,
    });
  }

  const energyWh = hasEnergy
    ? contribution.energyWh!
    : contribution.batterySidePowerW! * contribution.durationHours!;
  return contributionResult(contribution, {
    resolvedEnergyWh: normalizeZero(energyWh),
    energyStatus: 'resolved',
    unresolvedFacts,
    issues,
  });
};

export const evaluateVariableSourceEnergySequence = (
  input: VariableSourceEnergySequenceInput,
): VariableSourceEnergySequenceResult => {
  const intervals: VariableSourceEnergyIntervalResult[] = [];
  const issues: string[] = [];
  const unresolvedIntervalIds: string[] = [];
  const failedIntervalIds: string[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  let knownSourceEnergyWh = 0;

  input.intervals.forEach((interval, sequenceIndex) => {
    if (seenIds.has(interval.intervalId)) duplicateIds.add(interval.intervalId);
    seenIds.add(interval.intervalId);
    const contributions = interval.contributions.map(evaluateContribution);
    const intervalIssues = contributions.flatMap((entry) => entry.issues);
    const unresolvedFacts = contributions.flatMap((entry) => entry.unresolvedFacts);
    const knownEnergy = contributions.reduce(
      (sum, entry) =>
        sum +
        (entry.energyStatus === 'resolved'
          ? (entry.energyWh ?? entry.batterySidePowerW! * entry.durationHours!)
          : 0),
      0,
    );
    knownSourceEnergyWh += knownEnergy;
    const failed = intervalIssues.length > 0;
    const unresolved = !failed && unresolvedFacts.length > 0;
    const totalSourceEnergyWh = !failed && !unresolved ? normalizeZero(knownEnergy) : undefined;
    const energyStatus: VariableSourceEnergyStatus = failed
      ? 'failed'
      : unresolved
        ? 'unresolved'
        : 'resolved';
    if (failed) failedIntervalIds.push(interval.intervalId);
    if (unresolved) unresolvedIntervalIds.push(interval.intervalId);
    intervals.push({
      sequenceIndex,
      intervalId: interval.intervalId,
      sourceContributions: contributions,
      knownSourceEnergyWh: normalizeZero(knownEnergy),
      ...(totalSourceEnergyWh === undefined ? {} : { totalSourceEnergyWh }),
      energyStatus,
      unresolvedFacts,
      issues: intervalIssues,
    });
  });

  for (const intervalId of duplicateIds) {
    issues.push(`Duplicate interval ID: ${intervalId}.`);
  }
  for (const interval of intervals) {
    issues.push(...interval.issues, ...interval.unresolvedFacts);
  }
  const hasFailure = duplicateIds.size > 0 || failedIntervalIds.length > 0;
  const hasUnresolved = unresolvedIntervalIds.length > 0;
  const severity: EngineeringSeverity = hasFailure
    ? 'FAIL'
    : hasUnresolved
      ? 'CONDITIONAL'
      : 'PASS';
  const completeSequence = !hasFailure && !hasUnresolved;
  return {
    sequenceId: input.sequenceId,
    severity,
    status: severity,
    code:
      severity === 'FAIL'
        ? 'variable_source_energy.failed'
        : severity === 'CONDITIONAL'
          ? 'variable_source_energy.unresolved'
          : 'variable_source_energy.pass',
    message:
      severity === 'FAIL'
        ? 'Variable source energy sequence validation failed.'
        : severity === 'CONDITIONAL'
          ? 'Variable source energy sequence retains known contributions but cannot prove a complete total.'
          : 'Variable source energy sequence is fully resolved.',
    completeSequence,
    intervalCount: intervals.length,
    intervals,
    knownSourceEnergyWh: normalizeZero(knownSourceEnergyWh),
    ...(completeSequence ? { totalSourceEnergyWh: normalizeZero(knownSourceEnergyWh) } : {}),
    unresolvedIntervalIds: [...new Set(unresolvedIntervalIds)],
    failedIntervalIds: [...new Set(failedIntervalIds)],
    issues: [...new Set(issues)],
  };
};

export const composeVariableSourceAndLoadEnergy = (
  input: VariableSourceAndLoadEnergyInput,
): VariableSourceAndLoadEnergyResult => {
  const source = input.sourceInterval;
  const issues = [...source.issues];
  const unresolvedFacts = [...source.unresolvedFacts];
  if (input.loadEnergyWh !== undefined && !finite(input.loadEnergyWh)) {
    issues.push('loadEnergyWh must be finite when supplied.');
  }
  const sourceFailed = source.energyStatus === 'failed';
  const loadInvalid = input.loadEnergyWh !== undefined && !finite(input.loadEnergyWh);
  const sourceResolved = source.energyStatus === 'resolved';
  const loadResolved = input.loadEnergyWh !== undefined && !loadInvalid;
  if (!loadResolved) unresolvedFacts.push('Load energy is unresolved; it is not zero.');
  const severity: EngineeringSeverity =
    sourceFailed || loadInvalid
      ? 'FAIL'
      : !sourceResolved || !loadResolved
        ? 'CONDITIONAL'
        : 'PASS';
  const netBatteryEnergyWh =
    severity === 'PASS'
      ? normalizeZero(source.totalSourceEnergyWh! + input.loadEnergyWh!)
      : undefined;
  return {
    intervalId: source.intervalId,
    severity,
    status: severity,
    code:
      severity === 'FAIL'
        ? 'variable_source_energy.composition_failed'
        : severity === 'CONDITIONAL'
          ? 'variable_source_energy.composition_unresolved'
          : 'variable_source_energy.composed',
    message:
      severity === 'PASS'
        ? 'Explicit source and load energy were composed using the net battery-energy sign convention.'
        : severity === 'FAIL'
          ? 'Variable source and load energy composition failed validation.'
          : 'Variable source and load energy composition retains unresolved inputs.',
    ...(sourceResolved ? { sourceEnergyWh: source.totalSourceEnergyWh } : {}),
    ...(loadResolved ? { loadEnergyWh: input.loadEnergyWh } : {}),
    ...(netBatteryEnergyWh === undefined ? {} : { netBatteryEnergyWh }),
    unresolvedFacts: [...new Set(unresolvedFacts)],
    issues: [...new Set(issues)],
  };
};
