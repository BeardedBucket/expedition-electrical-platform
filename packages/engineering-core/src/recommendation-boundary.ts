import {
  evaluateComponentAdvisories,
  type AdvisoryPolicyConfiguration,
  type EvidenceRecord,
  type AdvisoryRecord,
} from './advisory.js';
import type { ComponentRecord, Recommendation } from './contracts.js';

export interface GlobalRecommendationCandidate {
  readonly component: ComponentRecord;
  readonly engineeringStatus: 'compatible' | 'incompatible' | 'unknown';
}

export interface AdvisoryAwareCandidate extends GlobalRecommendationCandidate {
  readonly advisory: ReturnType<typeof evaluateComponentAdvisories>;
  readonly recommendationEligible: boolean;
}

export interface AdvisoryBoundaryResult {
  readonly globalCandidates: readonly AdvisoryAwareCandidate[];
  readonly recommendations: readonly Recommendation[];
  readonly inspectableAdvisoryCandidates: readonly Recommendation[];
}

export const evaluateAdvisoryRecommendationBoundary = (
  candidates: readonly GlobalRecommendationCandidate[],
  advisories: readonly AdvisoryRecord[],
  evidence: readonly EvidenceRecord[],
  evaluatedAt: string,
  configuration?: AdvisoryPolicyConfiguration,
): AdvisoryBoundaryResult => {
  const evaluated = candidates.map((candidate) => {
    const advisory = evaluateComponentAdvisories(
      candidate.component.id,
      advisories,
      evidence,
      evaluatedAt,
      configuration,
    );
    const recommendationEligible =
      candidate.engineeringStatus === 'compatible' &&
      advisory.effective_policy_action !== 'exclude' &&
      advisory.effective_policy_action !== 'suppress_recommendation';
    return { ...candidate, advisory, recommendationEligible };
  });

  const toRecommendation = (candidate: AdvisoryAwareCandidate): Recommendation => ({
    id: candidate.component.id,
    engineeringStatus: candidate.engineeringStatus,
    advisory: candidate.advisory,
    why:
      candidate.advisory.effective_policy_action === 'caution'
        ? `${candidate.component.id} is engineering-compatible and remains eligible with an advisory caution.`
        : `${candidate.component.id} is engineering-compatible and globally eligible.`,
  });

  return {
    globalCandidates: evaluated,
    recommendations: evaluated
      .filter((candidate) => candidate.recommendationEligible)
      .map(toRecommendation),
    inspectableAdvisoryCandidates: evaluated
      .filter(
        (candidate) =>
          candidate.engineeringStatus === 'compatible' &&
          candidate.advisory.effective_policy_action === 'suppress_recommendation',
      )
      .map(toRecommendation),
  };
};
