import type {
  DemoData,
  RecommendationResult,
  Requirements,
  TraceMetadata,
  TraceStep,
} from './contracts.js';
import { evaluateAdvisoryRecommendationBoundary } from './recommendation-boundary.js';

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
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

const validateRequirements = (requirements: Requirements): void => {
  if (!Number.isFinite(requirements.systemVoltageV) || requirements.systemVoltageV <= 0) {
    throw new Error('A positive, user-selected system voltage is required.');
  }
};

export const orchestrateRecommendations = (
  requirements: Requirements,
  data: DemoData,
  options: {
    readonly evaluatedAt?: string;
  } = {},
): RecommendationResult => {
  validateRequirements(requirements);
  const evidence = data.evidence ?? [];
  const hasAdvisoryEvaluation = data.advisories.length > 0 || evidence.length > 0;
  if (hasAdvisoryEvaluation && !options.evaluatedAt) {
    throw new Error(
      'An explicit evaluation timestamp is required when advisory or evidence records are loaded.',
    );
  }
  const boundary = hasAdvisoryEvaluation
    ? evaluateAdvisoryRecommendationBoundary(
        data.components.map((component) => ({
          component,
          engineeringStatus: component.engineeringStatus ?? 'compatible',
        })),
        data.advisories,
        evidence,
        options.evaluatedAt!,
      )
    : { recommendations: [], inspectableAdvisoryCandidates: [] };

  const steps: readonly TraceStep[] = [
    { id: 'requirements', status: 'complete', summary: 'Requirements accepted.' },
    {
      id: 'advisories',
      status: data.advisories.length === 0 ? 'empty' : 'complete',
      summary:
        data.advisories.length === 0
          ? 'No advisory records are loaded.'
          : 'Advisory records evaluated before recommendations.',
    },
    {
      id: 'engineering-compatibility',
      status: data.components.length === 0 ? 'empty' : 'complete',
      summary:
        data.components.length === 0
          ? 'No component records are loaded.'
          : 'Component compatibility evaluated before commercial preferences.',
    },
    {
      id: 'builder-overlay',
      status: data.builders.length === 0 ? 'empty' : 'complete',
      summary:
        data.builders.length === 0
          ? 'No builder inventory is loaded.'
          : 'Builder overlays applied only after engineering filtering.',
    },
    {
      id: 'recommendations',
      status: data.components.length === 0 ? 'empty' : 'complete',
      summary:
        data.components.length === 0
          ? 'No recommendations can be produced from empty demo collections.'
          : 'Recommendations selected deterministically.',
    },
  ];

  const trace: TraceMetadata = {
    inputFingerprint: fingerprint(requirements),
    dataFingerprint: fingerprint(data),
    ruleSet: data.ruleSet,
    datasets: data.versions,
    steps,
  };

  return {
    recommendations: boundary.recommendations,
    inspectableAdvisoryCandidates: boundary.inspectableAdvisoryCandidates,
    trace,
  };
};
