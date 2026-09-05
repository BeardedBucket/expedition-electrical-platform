import { compareSystemVoltageCandidates, evaluateWireCandidate } from './calculations.js';
import type {
  CalculationResult,
  DecisionTrace,
  SourceReference,
  StandardsDataProfile,
  VoltageCandidate,
  WireCandidate,
  WireConstraints,
} from './contracts.js';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprint = (value: unknown): string => {
  let hash = 2166136261;
  for (const character of stableSerialize(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const deduplicateSources = (sources: readonly SourceReference[]): readonly SourceReference[] => [
  ...new Map(sources.map((source) => [source.id, source])).values(),
];

const resolveAmpacity = (
  record: NonNullable<StandardsDataProfile['ampacityRecords']>[number] | undefined,
): CalculationResult<number> => {
  if (record === undefined) {
    return {
      ok: false,
      code: 'insufficient_data',
      reasons: ['No matching installation-specific ampacity record exists.'],
      warnings: [],
    };
  }
  if (!Number.isFinite(record.baseAmpacityA) || record.baseAmpacityA < 0) {
    return {
      ok: false,
      code: 'invalid_input',
      reasons: ['Base ampacity must be finite and non-negative.'],
      warnings: [],
    };
  }
  let ampacity = record.baseAmpacityA;
  for (const derating of record.deratingInputs) {
    if (!Number.isFinite(derating.factor) || derating.factor <= 0 || derating.factor > 1) {
      return {
        ok: false,
        code: 'invalid_input',
        reasons: ['Every derating factor must be finite, greater than 0, and no greater than 1.'],
        warnings: [],
      };
    }
    ampacity *= derating.factor;
  }
  return { ok: true, value: ampacity, warnings: [] };
};

export interface EngineeringEvaluationInput {
  readonly systemVoltageComparison: {
    readonly powerW: number;
    readonly powerBasis: 'direct-source' | 'converted-load';
    readonly conversionEfficiency?: number;
  };
  readonly systemVoltageCandidates: readonly VoltageCandidate[];
  readonly wireCandidates: readonly WireCandidate[];
  readonly wireConstraints: WireConstraints;
}

export interface EngineeringEvaluationResult {
  readonly systemVoltageCandidates: readonly VoltageCandidate[];
  readonly wireCandidates: readonly ReturnType<typeof evaluateWireCandidate>[];
}

export const evaluateEngineeringRules = (
  input: EngineeringEvaluationInput,
  profile: StandardsDataProfile,
): DecisionTrace => {
  const ampacityRecords = input.wireCandidates
    .map((candidate) =>
      profile.ampacityRecords?.find(
        (record) =>
          record.conductorGauge === candidate.gauge &&
          record.installationConditionId === input.wireConstraints.installationConditionId,
      ),
    )
    .filter((record): record is NonNullable<typeof record> => record !== undefined);
  const sources = deduplicateSources([
    ...profile.sources,
    ...ampacityRecords.flatMap((record) => [
      ...record.sourceReferences,
      ...record.deratingInputs.flatMap((derating) => derating.sourceReferences),
    ]),
  ]);
  const voltageResult = compareSystemVoltageCandidates(
    input.systemVoltageComparison,
    input.systemVoltageCandidates,
  );
  const wireResults = input.wireCandidates.map((candidate) => {
    const record = ampacityRecords.find((entry) => entry.conductorGauge === candidate.gauge);
    const ampacity = resolveAmpacity(record);
    if (!ampacity.ok) return ampacity;
    return evaluateWireCandidate(
      {
        ...candidate,
        resistanceOhmPerM:
          candidate.resistanceOhmPerM ?? profile.resistancePerLengthOhmPerM?.[candidate.gauge],
      },
      input.wireConstraints,
      ampacity.value,
    );
  });
  const insufficientDataReasons = [
    ...(voltageResult.ok
      ? []
      : voltageResult.code === 'insufficient_data'
        ? voltageResult.reasons
        : []),
    ...wireResults.flatMap((result) =>
      result.ok || result.code !== 'insufficient_data' ? [] : result.reasons,
    ),
  ];
  const warnings = wireResults.flatMap((result) => (result.ok ? result.warnings : []));
  const voltageStatus = voltageResult.ok
    ? 'complete'
    : voltageResult.code === 'insufficient_data'
      ? 'empty'
      : 'failed';
  const wireStatus = wireResults.every((result) => result.ok)
    ? 'complete'
    : wireResults.some((result) => !result.ok && result.code === 'invalid_input')
      ? 'failed'
      : 'empty';
  const steps = [
    {
      id: 'system-voltage-comparison',
      status: voltageStatus as 'complete' | 'empty' | 'failed',
      summary:
        'System-voltage candidates were compared using the declared source or converted-load power basis.',
      inputs: {
        systemVoltageComparison: input.systemVoltageComparison,
        systemVoltageCandidates: input.systemVoltageCandidates,
      },
      result: voltageResult,
    },
    {
      id: 'wire-candidate-filter',
      status: wireStatus as 'complete' | 'empty' | 'failed',
      summary: 'Ampacity and voltage-drop suitability were evaluated as separate constraints.',
      inputs: { candidates: input.wireCandidates, constraints: input.wireConstraints },
      result: wireResults,
    },
  ];
  return {
    inputs: input,
    calculationSteps: steps,
    ruleIds: [
      { id: 'electrical.system-voltage-comparison', version: '1.0.0' },
      { id: 'electrical.wire-candidate-filter', version: '1.0.0' },
    ],
    standardsProfile: { id: profile.id, version: profile.version, status: profile.status },
    results: { systemVoltageCandidates: voltageResult, wireCandidates: wireResults },
    warnings,
    insufficientDataReasons,
    sourceReferences: sources,
    inputFingerprint: fingerprint({ input, profile }),
  };
};
