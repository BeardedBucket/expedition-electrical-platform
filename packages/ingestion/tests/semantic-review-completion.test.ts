import { describe, expect, it } from 'vitest';
import {
  evaluateSemanticReviewCompletion,
  type ReviewedSemanticInterpretation,
  type SemanticProposal,
} from '../src/index.js';

const proposal = (
  id: string,
  disposition: SemanticProposal['disposition'],
  derivation = false,
): Pick<SemanticProposal, 'id' | 'disposition' | 'derivation'> => ({
  id,
  disposition,
  ...(derivation
    ? {
        derivation: {
          status: 'derived',
          rule_version: 'test',
          formula: 'test',
          input_targets: [],
          input_units: [],
          output_unit: '',
          assumptions: [],
        },
      }
    : {}),
});

const interpretation = (
  entries: ReviewedSemanticInterpretation['entries'],
): ReviewedSemanticInterpretation => ({
  input_snapshot: 'snapshot',
  entries,
  stale_decision_refs: [],
});

const humanEntry = (
  proposal_id: string,
  state: Extract<
    ReviewedSemanticInterpretation['entries'][number]['state'],
    'human_mapped' | 'evidence_only' | 'schema_gap' | 'reject' | 'not_applicable' | 'unresolved'
  >,
): ReviewedSemanticInterpretation['entries'][number] => ({
  proposal_id,
  automatic_target: '',
  automatic_disposition: 'unresolved',
  state,
  decision_ref: {
    kind: 'reviewed_semantic_decision',
    reference: `decision.${proposal_id}`,
    reference_schema_version: '1.0',
    digest_algorithm: 'sha256',
    digest: `sha256:${'0'.repeat(64)}`,
  },
});

describe('semantic review completion', () => {
  it('does not over-gate automatically mapped or derived proposals', () => {
    expect(
      evaluateSemanticReviewCompletion(
        [proposal('automatic', 'mapped'), proposal('derived', 'unresolved', true)],
        interpretation([]),
      ),
    ).toEqual({ complete: true, required_dispositions: [] });
  });

  it('requires a current human disposition for non-derived unmapped proposals', () => {
    expect(
      evaluateSemanticReviewCompletion(
        [proposal('unsupported', 'unsupported'), proposal('unresolved', 'unresolved')],
        interpretation([]),
      ),
    ).toEqual({
      complete: false,
      required_dispositions: [
        { proposal_id: 'unresolved', reason: 'no_current_human_disposition' },
        { proposal_id: 'unsupported', reason: 'no_current_human_disposition' },
      ],
    });
  });

  it.each([
    'human_mapped',
    'evidence_only',
    'schema_gap',
    'reject',
    'not_applicable',
    'unresolved',
  ] as const)('accepts an explicit %s disposition as reviewed', (state) => {
    expect(
      evaluateSemanticReviewCompletion(
        [proposal('needs-review', 'unsupported')],
        interpretation([humanEntry('needs-review', state)]),
      ),
    ).toEqual({ complete: true, required_dispositions: [] });
  });

  it('does not let a disposition for one proposal satisfy another proposal', () => {
    expect(
      evaluateSemanticReviewCompletion(
        [proposal('first', 'unsupported'), proposal('second', 'ambiguous')],
        interpretation([humanEntry('first', 'evidence_only')]),
      ),
    ).toMatchObject({
      complete: false,
      required_dispositions: [{ proposal_id: 'second' }],
    });
  });

  it('does not count stale decisions as active dispositions', () => {
    const stale = humanEntry('needs-review', 'unresolved');
    expect(
      evaluateSemanticReviewCompletion(
        [proposal('needs-review', 'unsupported')],
        interpretation([{ ...stale, state: 'stale' }]),
      ).complete,
    ).toBe(false);
  });
});
