import type {
  InstalledCommunicationInterpretation,
  InstalledCommunicationDiagnostic,
  InstalledCommunicationSupportPath,
} from './installed-communication-interpretation.js';
import type { InstalledInteractionParticipantTarget } from './installed-interaction-evaluation.js';

export interface InstalledInformationRequirement {
  readonly id: string;
  readonly kind: 'information';
  readonly term: string;
  readonly source: InstalledInteractionParticipantTarget;
  readonly consumer: InstalledInteractionParticipantTarget;
}

export interface InstalledControlRequirement {
  readonly id: string;
  readonly kind: 'control';
  readonly action: string;
  readonly controller: InstalledInteractionParticipantTarget;
  readonly target: InstalledInteractionParticipantTarget;
}

export type InstalledCommunicationRequirement =
  InstalledInformationRequirement | InstalledControlRequirement;

export interface InstalledInformationRequirementResult {
  readonly requirement_id: string;
  readonly kind: 'information';
  readonly status: 'satisfied' | 'unknown';
  readonly reason_code?:
    'no_matching_information_availability' | 'ambiguous_information_interpretation';
  readonly matched_fact_id?: string;
  readonly support?: readonly InstalledCommunicationSupportPath[];
  readonly diagnostic_codes?: readonly InstalledCommunicationDiagnostic['code'][];
}

export interface InstalledControlRequirementResult {
  readonly requirement_id: string;
  readonly kind: 'control';
  readonly status: 'satisfied' | 'unknown';
  readonly reason_code?:
    'no_matching_control_availability' | 'ambiguous_information_interpretation';
  readonly matched_fact_id?: string;
  readonly support?: readonly InstalledCommunicationSupportPath[];
  readonly diagnostic_codes?: readonly InstalledCommunicationDiagnostic['code'][];
}

export type InstalledCommunicationRequirementResult =
  InstalledInformationRequirementResult | InstalledControlRequirementResult;

export interface InstalledCommunicationRequirementEvaluationInput {
  readonly requirements: readonly InstalledCommunicationRequirement[];
  readonly interpretation: InstalledCommunicationInterpretation;
}

export interface InstalledCommunicationRequirementEvaluation {
  readonly results: readonly InstalledCommunicationRequirementResult[];
}

const isTarget = (value: unknown): value is InstalledInteractionParticipantTarget => {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  if (target.kind === 'component_instance' || target.kind === 'installed_artifact') {
    const key = target.kind === 'component_instance' ? 'instance_id' : 'artifact_id';
    return typeof target[key] === 'string' && target[key].length > 0;
  }
  if (target.kind === 'interaction_endpoint') {
    const endpoint = target.endpoint;
    return (
      !!endpoint &&
      typeof endpoint === 'object' &&
      typeof (endpoint as Record<string, unknown>).instance_id === 'string' &&
      (endpoint as Record<string, unknown>).instance_id !== '' &&
      typeof (endpoint as Record<string, unknown>).endpoint_id === 'string' &&
      (endpoint as Record<string, unknown>).endpoint_id !== ''
    );
  }
  return false;
};

const targetKey = (target: InstalledInteractionParticipantTarget): string =>
  target.kind === 'component_instance'
    ? `component_instance:${target.instance_id}`
    : target.kind === 'interaction_endpoint'
      ? `interaction_endpoint:${target.endpoint.instance_id}:${target.endpoint.endpoint_id}`
      : `installed_artifact:${target.artifact_id}`;

const targetsEqual = (
  left: InstalledInteractionParticipantTarget,
  right: InstalledInteractionParticipantTarget,
): boolean => targetKey(left) === targetKey(right);

const validateRequirement = (requirement: InstalledCommunicationRequirement): void => {
  if (!requirement || typeof requirement !== 'object') {
    throw new Error('Requirement must be an object.');
  }
  if (typeof requirement.id !== 'string' || requirement.id.length === 0) {
    throw new Error('Requirement ID must be non-empty.');
  }
  if (requirement.kind === 'information') {
    if (typeof requirement.term !== 'string' || requirement.term.length === 0) {
      throw new Error(`Information requirement '${requirement.id}' term must be non-empty.`);
    }
    if (!isTarget(requirement.source) || !isTarget(requirement.consumer)) {
      throw new Error(`Information requirement '${requirement.id}' has an invalid target.`);
    }
  } else if (requirement.kind === 'control') {
    if (typeof requirement.action !== 'string' || requirement.action.length === 0) {
      throw new Error(`Control requirement '${requirement.id}' action must be non-empty.`);
    }
    if (!isTarget(requirement.controller) || !isTarget(requirement.target)) {
      throw new Error(`Control requirement '${requirement.id}' has an invalid target.`);
    }
  } else {
    throw new Error('Requirement has an unsupported kind.');
  }
};

const diagnosticCodes = (
  interpretation: InstalledCommunicationInterpretation,
): readonly InstalledCommunicationDiagnostic['code'][] =>
  interpretation.diagnostics
    .map((diagnostic) => diagnostic.code)
    .filter((code, index, codes) => codes.indexOf(code) === index)
    .sort();

export const evaluateInstalledCommunicationRequirements = (
  input: InstalledCommunicationRequirementEvaluationInput,
): InstalledCommunicationRequirementEvaluation => {
  const ids = new Set<string>();
  for (const requirement of input.requirements) {
    validateRequirement(requirement);
    if (ids.has(requirement.id)) {
      throw new Error(`Duplicate requirement ID '${requirement.id}'.`);
    }
    ids.add(requirement.id);
  }

  const diagnostics = diagnosticCodes(input.interpretation);
  const results = input.requirements.map((requirement): InstalledCommunicationRequirementResult => {
    if (requirement.kind === 'information') {
      const fact = input.interpretation.information_availability.find(
        (candidate) =>
          candidate.term === requirement.term &&
          targetsEqual(candidate.source.target, requirement.source) &&
          targetsEqual(candidate.consumer.target, requirement.consumer),
      );
      if (fact) {
        return {
          requirement_id: requirement.id,
          kind: 'information',
          status: 'satisfied',
          matched_fact_id: fact.id,
          support: fact.support,
        };
      }
      return {
        requirement_id: requirement.id,
        kind: 'information',
        status: 'unknown',
        reason_code: diagnostics.includes('ambiguous_information_source')
          ? 'ambiguous_information_interpretation'
          : 'no_matching_information_availability',
        ...(diagnostics.length > 0 ? { diagnostic_codes: diagnostics } : {}),
      };
    }

    const fact = input.interpretation.control_availability.find(
      (candidate) =>
        candidate.action === requirement.action &&
        targetsEqual(candidate.controller.target, requirement.controller) &&
        targetsEqual(candidate.target.target, requirement.target),
    );
    if (fact) {
      return {
        requirement_id: requirement.id,
        kind: 'control',
        status: 'satisfied',
        matched_fact_id: fact.id,
        support: fact.support,
      };
    }
    return {
      requirement_id: requirement.id,
      kind: 'control',
      status: 'unknown',
      reason_code: 'no_matching_control_availability',
      ...(diagnostics.length > 0 ? { diagnostic_codes: diagnostics } : {}),
    };
  });

  return {
    results: [...results].sort((left, right) =>
      left.requirement_id.localeCompare(right.requirement_id),
    ),
  };
};
