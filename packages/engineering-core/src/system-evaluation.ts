import type { EngineeringIssue, EngineeringSeverity } from './battery-power.js';

export type SystemEvaluationScopeState = 'required' | 'optional' | 'omitted' | 'unresolved';
export type SystemEvaluationSubsystem =
  | 'requirements'
  | 'loads'
  | 'loadStates'
  | 'operatingScenarios'
  | 'charging'
  | 'powerBalance'
  | 'energy'
  | 'storage'
  | 'socReserve'
  | 'recharge'
  | 'variableSources'
  | 'mixedVoltage';

export interface SystemSummaryObservation {
  readonly key: string;
  readonly value: unknown;
  readonly origin: SystemEvaluationSubsystem | 'system';
  readonly provenance?: readonly string[];
  readonly unit?: string;
}

export interface SystemEvaluationIssue extends EngineeringIssue {
  readonly subsystem: SystemEvaluationSubsystem | 'system';
}

export interface SystemEvaluationFailedConstraint {
  readonly subsystem: SystemEvaluationSubsystem;
  readonly severity: EngineeringSeverity;
  readonly code: string;
  readonly message: string;
}

export interface SystemEvaluationDependency {
  readonly subsystem: SystemEvaluationSubsystem;
  readonly status: EngineeringSeverity;
  readonly reason: string;
  readonly required: boolean;
}

export interface SystemEvaluationScope {
  requirements?: SystemEvaluationScopeState;
  loads?: SystemEvaluationScopeState;
  loadStates?: SystemEvaluationScopeState;
  operatingScenarios?: SystemEvaluationScopeState;
  charging?: SystemEvaluationScopeState;
  powerBalance?: SystemEvaluationScopeState;
  energy?: SystemEvaluationScopeState;
  storage?: SystemEvaluationScopeState;
  socReserve?: SystemEvaluationScopeState;
  recharge?: SystemEvaluationScopeState;
  variableSources?: SystemEvaluationScopeState;
  mixedVoltage?: SystemEvaluationScopeState;
}

export interface SystemEvaluationInput {
  readonly systemId?: string;
  readonly scope?: SystemEvaluationScope;
  readonly requirements?: unknown;
  readonly loads?: unknown;
  readonly loadStates?: unknown;
  readonly operatingScenarios?: unknown;
  readonly charging?: unknown;
  readonly powerBalance?: unknown;
  readonly energy?: unknown;
  readonly storage?: unknown;
  readonly socReserve?: unknown;
  readonly recharge?: unknown;
  readonly variableSources?: unknown;
  readonly mixedVoltage?: unknown;
  readonly issues?: readonly EngineeringIssue[];
}

export interface SystemEvaluationResult {
  systemId?: string;
  scope: SystemEvaluationScope;
  status: EngineeringSeverity;
  severity: EngineeringSeverity;
  code: string;
  message: string;
  requirements?: unknown;
  loads?: unknown;
  loadStates?: unknown;
  operatingScenarios?: unknown;
  charging?: unknown;
  powerBalance?: unknown;
  energy?: unknown;
  storage?: unknown;
  socReserve?: unknown;
  recharge?: unknown;
  variableSources?: unknown;
  mixedVoltage?: unknown;
  summaryObservations: readonly SystemSummaryObservation[];
  issues: readonly SystemEvaluationIssue[];
  failedConstraints: readonly SystemEvaluationFailedConstraint[];
  unresolvedDependencies: readonly SystemEvaluationDependency[];
  subsystemResults: Record<string, unknown>;
}

const SUBSYSTEM_KEYS: readonly SystemEvaluationSubsystem[] = [
  'requirements',
  'loads',
  'loadStates',
  'operatingScenarios',
  'charging',
  'powerBalance',
  'energy',
  'storage',
  'socReserve',
  'recharge',
  'variableSources',
  'mixedVoltage',
];

const severityRank: Readonly<Record<EngineeringSeverity, number>> = {
  PASS: 0,
  INFORMATION: 0,
  WARNING: 1,
  CONDITIONAL: 2,
  FAIL: 3,
};

const normalizeSeverity = (value: unknown): EngineeringSeverity | undefined => {
  if (typeof value !== 'string') return undefined;
  if (value === 'PASS' || value === 'FAIL' || value === 'WARNING' || value === 'CONDITIONAL') {
    return value;
  }
  if (value === 'INFORMATION') return value;
  return undefined;
};

const highestSeverity = (
  values: readonly (EngineeringSeverity | undefined)[],
): EngineeringSeverity => {
  const candidates = values.filter((value): value is EngineeringSeverity => value !== undefined);
  if (candidates.length === 0) return 'PASS';
  return candidates.reduce((highest, current) =>
    severityRank[current] > severityRank[highest] ? current : highest,
  );
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toEngineeredIssue = (
  result: unknown,
  subsystem: SystemEvaluationSubsystem,
  fallbackMessage?: string,
): SystemEvaluationIssue | undefined => {
  if (!isPlainObject(result)) return undefined;

  const severity = normalizeSeverity(result.severity ?? result.status);
  if (severity === undefined || severityRank[severity] === 0) return undefined;

  return {
    subsystem,
    severity,
    code: typeof result.code === 'string' ? result.code : `${subsystem}.result`,
    message:
      typeof result.message === 'string'
        ? result.message
        : (fallbackMessage ?? 'Subsystem result is unresolved.'),
  };
};

const collectIssues = (
  result: unknown,
  subsystem: SystemEvaluationSubsystem,
): readonly SystemEvaluationIssue[] => {
  if (Array.isArray(result)) {
    return result.flatMap((entry) => collectIssues(entry, subsystem));
  }

  const issues: SystemEvaluationIssue[] = [];
  const direct = toEngineeredIssue(result, subsystem);
  if (direct) issues.push(direct);

  if (isPlainObject(result)) {
    const rawIssues = Array.isArray(result.issues) ? result.issues : [];
    for (const entry of rawIssues) {
      if (isPlainObject(entry) && typeof entry.message === 'string') {
        issues.push({
          subsystem,
          severity: normalizeSeverity(entry.severity ?? entry.status) ?? 'CONDITIONAL',
          code: typeof entry.code === 'string' ? entry.code : `${subsystem}.issue`,
          message: entry.message,
        });
      } else if (typeof entry === 'string') {
        issues.push({
          subsystem,
          severity: normalizeSeverity(result.severity ?? result.status) ?? 'CONDITIONAL',
          code: `${subsystem}.issue`,
          message: entry,
        });
      }
    }

    const unresolvedFacts = Array.isArray(result.unresolvedFacts) ? result.unresolvedFacts : [];
    for (const fact of unresolvedFacts) {
      if (typeof fact === 'string') {
        issues.push({
          subsystem,
          severity: 'CONDITIONAL',
          code: `${subsystem}.unresolved_fact`,
          message: fact,
        });
      }
    }

    const unresolvedInputs = Array.isArray(result.unresolvedInputs) ? result.unresolvedInputs : [];
    for (const fact of unresolvedInputs) {
      if (typeof fact === 'string') {
        issues.push({
          subsystem,
          severity: 'CONDITIONAL',
          code: `${subsystem}.unresolved_input`,
          message: fact,
        });
      }
    }
  }

  return issues;
};

/**
 * Alternative cases supplied as an array contribute their highest local severity
 * without any of their observations being merged or summed.
 */
const priorityForResult = (result: unknown): EngineeringSeverity => {
  if (Array.isArray(result)) {
    return highestSeverity(result.map((entry) => priorityForResult(entry)));
  }
  if (isPlainObject(result)) {
    const severity = normalizeSeverity(result.severity ?? result.status);
    if (severity) return severity;
  }
  return 'PASS';
};

const collectFailedConstraints = (
  result: unknown,
  subsystem: SystemEvaluationSubsystem,
): readonly SystemEvaluationFailedConstraint[] => {
  if (Array.isArray(result)) {
    return result.flatMap((entry) => collectFailedConstraints(entry, subsystem));
  }
  if (!isPlainObject(result)) return [];

  const severity = normalizeSeverity(result.severity ?? result.status);
  if (severity !== 'FAIL') return [];

  return [
    {
      subsystem,
      severity,
      code: typeof result.code === 'string' ? result.code : `${subsystem}.failed`,
      message:
        typeof result.message === 'string'
          ? result.message
          : `${subsystem} reported a local failure.`,
    },
  ];
};

const extractSummaryObservations = (
  entries: Readonly<Record<string, unknown>>,
): readonly SystemSummaryObservation[] => {
  const observations: SystemSummaryObservation[] = [];
  const candidateKeys = [
    'totalLoadEnergyWh',
    'totalBatteryEnergyWh',
    'totalPowerW',
    'totalEnergyWh',
    'energyWh',
    'netBatteryEnergyWh',
    'totalSourceEnergyWh',
    'knownSourceEnergyWh',
    'endingStoredEnergyWh',
    'minimumStoredEnergyWh',
    'maximumStoredEnergyWh',
    'storedGainWh',
    'totalRequestedDischargeEnergyWh',
    'totalDeliveredDischargeEnergyWh',
    'totalStoredChargingEnergyWh',
    'totalCurtailedEnergyWh',
    'totalUnmetEnergyWh',
    'minimumSoc',
    'endingSoc',
    'usableWindowSocPercent',
    'reserveState',
    'reserveMarginWh',
    'minimumReserveMarginPercentagePoints',
    'reserveMarginPercentagePoints',
    'requiredRecoveryEnergyWh',
    'recoverableEnergyWh',
    'energyShortfallWh',
    'energySurplusWh',
    'recoveryFeasible',
    'failedConstraintCount',
    'unresolvedDependencyCount',
    'requiredConversionPathCount',
  ];

  for (const [subsystem, value] of Object.entries(entries)) {
    if (isPlainObject(value)) {
      for (const key of candidateKeys) {
        const candidate = (value as Record<string, unknown>)[key];
        if (candidate !== undefined) {
          observations.push({
            key,
            value: candidate,
            origin: subsystem as SystemEvaluationSubsystem,
            provenance: [subsystem],
          });
        }
      }
    }
  }

  return observations;
};

const buildUnresolvedDependencies = (
  scope: SystemEvaluationScope,
  entries: Readonly<Record<string, unknown>>,
): readonly SystemEvaluationDependency[] => {
  const dependencies: SystemEvaluationDependency[] = [];

  for (const subsystem of SUBSYSTEM_KEYS) {
    const state = scope[subsystem] ?? 'optional';
    const value = entries[subsystem];

    if (state === 'required' && value === undefined) {
      dependencies.push({
        subsystem,
        status: 'CONDITIONAL',
        reason: `${subsystem} was declared required but no result was supplied.`,
        required: true,
      });
      continue;
    }

    if (value === undefined) continue;

    const severity = priorityForResult(value);
    if (severity === 'CONDITIONAL') {
      const reasons = [...collectIssues(value, subsystem)].map((issue) => issue.message);
      dependencies.push({
        subsystem,
        status: severity,
        reason: reasons[0] ?? `${subsystem} result remains unresolved or partially resolved.`,
        required: state === 'required',
      });
    }
  }

  return dependencies;
};

const normalizeScope = (scope?: SystemEvaluationScope): SystemEvaluationScope => {
  if (!scope) return {};
  const normalized: SystemEvaluationScope = {};
  for (const subsystem of SUBSYSTEM_KEYS) {
    const state = scope[subsystem] ?? 'optional';
    normalized[subsystem] = state;
  }
  return normalized;
};

const aggregationStatus = (severity: EngineeringSeverity): EngineeringSeverity => {
  if (severity === 'FAIL') return 'FAIL';
  if (severity === 'CONDITIONAL') return 'CONDITIONAL';
  if (severity === 'WARNING') return 'WARNING';
  if (severity === 'INFORMATION') return 'INFORMATION';
  return 'PASS';
};

export const evaluateSystem = (input: SystemEvaluationInput = {}): SystemEvaluationResult => {
  const scope = normalizeScope(input.scope);
  const subsystemResults: Record<string, unknown> = {};
  const allIssues: SystemEvaluationIssue[] = [
    ...(input.issues ?? []).map((issue) => ({ ...issue, subsystem: 'system' as const })),
  ];
  const severities: EngineeringSeverity[] = [];
  const failedConstraints: SystemEvaluationFailedConstraint[] = [];

  for (const subsystem of SUBSYSTEM_KEYS) {
    const value = (input as Record<string, unknown>)[subsystem];
    if (value === undefined) continue;
    subsystemResults[subsystem] = value;
    severities.push(priorityForResult(value));
    allIssues.push(...collectIssues(value, subsystem));
    failedConstraints.push(...collectFailedConstraints(value, subsystem));
  }

  const unresolvedDependencies = buildUnresolvedDependencies(scope, subsystemResults);
  const extractedObservations = extractSummaryObservations(subsystemResults);

  for (const dependency of unresolvedDependencies) {
    if (dependency.status === 'CONDITIONAL') {
      allIssues.push({
        subsystem: dependency.subsystem,
        severity: 'CONDITIONAL',
        code: `system_evaluation.unresolved_${dependency.subsystem}`,
        message: dependency.reason,
      });
    }
  }

  const dedupedIssues = allIssues.filter(
    (issue, index, array) =>
      index ===
      array.findIndex(
        (candidate) =>
          candidate.subsystem === issue.subsystem &&
          candidate.code === issue.code &&
          candidate.message === issue.message &&
          candidate.severity === issue.severity,
      ),
  );

  /**
   * A local FAIL is never masked by an unresolved dependency: unresolved data
   * cannot retract a failure that an upstream evaluator already reported.
   */
  const localSeverity = highestSeverity(severities);
  const aggregateSeverity =
    Object.keys(subsystemResults).length === 0
      ? 'CONDITIONAL'
      : localSeverity === 'FAIL'
        ? 'FAIL'
        : unresolvedDependencies.length > 0
          ? 'CONDITIONAL'
          : localSeverity;

  const status = aggregationStatus(aggregateSeverity);

  const message =
    Object.keys(subsystemResults).length === 0
      ? 'No subsystem results were supplied to the system evaluation; the evaluation scope is empty.'
      : status === 'FAIL'
        ? 'One or more subsystem evaluations failed; local failure scope is preserved.'
        : status === 'CONDITIONAL'
          ? 'The supplied evaluation scope is partially resolved or contains unresolved dependencies.'
          : 'The supplied system evaluation is fully resolved within the declared scope.';

  const result: Partial<SystemEvaluationResult> = {
    systemId: input.systemId,
    scope,
    status,
    severity: status,
    code:
      status === 'FAIL'
        ? 'system_evaluation.failed'
        : status === 'CONDITIONAL'
          ? 'system_evaluation.partial'
          : 'system_evaluation.pass',
    message,
    summaryObservations: extractedObservations,
    issues: dedupedIssues,
    failedConstraints,
    unresolvedDependencies,
    subsystemResults,
  };

  if (input.requirements !== undefined) result.requirements = input.requirements;
  if (input.loads !== undefined) result.loads = input.loads;
  if (input.loadStates !== undefined) result.loadStates = input.loadStates;
  if (input.operatingScenarios !== undefined) result.operatingScenarios = input.operatingScenarios;
  if (input.charging !== undefined) result.charging = input.charging;
  if (input.powerBalance !== undefined) result.powerBalance = input.powerBalance;
  if (input.energy !== undefined) result.energy = input.energy;
  if (input.storage !== undefined) result.storage = input.storage;
  if (input.socReserve !== undefined) result.socReserve = input.socReserve;
  if (input.recharge !== undefined) result.recharge = input.recharge;
  if (input.variableSources !== undefined) result.variableSources = input.variableSources;
  if (input.mixedVoltage !== undefined) result.mixedVoltage = input.mixedVoltage;

  return result as SystemEvaluationResult;
};

export const evaluateSystemEngineering = evaluateSystem;
export const evaluateSystemModel = evaluateSystem;
