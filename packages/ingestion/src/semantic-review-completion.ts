import type {
  ReviewedSemanticInterpretation,
  ReviewedSemanticInterpretationEntry,
  SemanticProposal,
} from './production-contracts.js';

export interface SemanticReviewDispositionRequirement {
  readonly proposal_id: string;
  readonly reason: 'no_current_human_disposition';
}

export interface SemanticReviewCompletion {
  readonly complete: boolean;
  readonly required_dispositions: readonly SemanticReviewDispositionRequirement[];
}

const HUMAN_DISPOSITION_STATES: ReadonlySet<ReviewedSemanticInterpretationEntry['state']> = new Set(
  ['human_mapped', 'evidence_only', 'schema_gap', 'reject', 'not_applicable', 'unresolved'],
);

/**
 * Review completion is accountability, not a requirement to force unresolved evidence into
 * canonical facts. The interpretation is replayed from durable decision history upstream.
 */
export const evaluateSemanticReviewCompletion = (
  proposals: readonly Pick<SemanticProposal, 'id' | 'derivation' | 'disposition'>[],
  interpretation: ReviewedSemanticInterpretation,
): SemanticReviewCompletion => {
  const entriesByProposal = new Map(
    interpretation.entries.map((entry) => [entry.proposal_id, entry]),
  );
  // Derived and already mapped proposals follow their own deterministic contracts; only a
  // current referenced human event can disposition an automatically unresolved proposal.
  const required_dispositions = proposals
    .filter((proposal) => !proposal.derivation && proposal.disposition !== 'mapped')
    .filter((proposal) => {
      const entry = entriesByProposal.get(proposal.id);
      return (
        !entry ||
        !entry.decision_ref ||
        !HUMAN_DISPOSITION_STATES.has(entry.state) ||
        entry.state === 'stale'
      );
    })
    .map((proposal) => ({
      proposal_id: proposal.id,
      reason: 'no_current_human_disposition' as const,
    }))
    .sort((left, right) => left.proposal_id.localeCompare(right.proposal_id));

  return { complete: required_dispositions.length === 0, required_dispositions };
};
