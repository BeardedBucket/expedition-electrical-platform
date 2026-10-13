import type {
  ReviewedSemanticInterpretation,
  ReviewedSemanticInterpretationEntry,
  SemanticProposal,
} from './production-contracts.js';
import { automaticEvidenceClassificationValid } from './retained-evidence-rules.js';

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
  proposals: readonly Pick<
    SemanticProposal,
    | 'id'
    | 'derivation'
    | 'disposition'
    | 'fact_refs'
    | 'evidence_classification'
    | 'proposed_value'
    | 'qualified_value'
    | 'semantic_assertions'
  >[],
  interpretation: ReviewedSemanticInterpretation,
): SemanticReviewCompletion => {
  const entriesByProposal = new Map(
    interpretation.entries.map((entry) => [entry.proposal_id, entry]),
  );
  // Only exact reviewed automatic evidence proof closes retained observations.
  // A bare evidence_only/unsupported/source_label string still requires a human.
  const required_dispositions = proposals
    .filter((proposal) => !proposal.derivation && proposal.disposition !== 'mapped')
    .filter((proposal) => {
      const entry = entriesByProposal.get(proposal.id);
      if (entry?.state === 'automatic' && automaticEvidenceClassificationValid(proposal))
        return false;
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
