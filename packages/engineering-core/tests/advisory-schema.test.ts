import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import advisorySchema from '../../../data/schemas/advisory.schema.json' with { type: 'json' };

// This test proves that scripts/validate-data.mjs (which compiles and runs this same schema
// against repository data files) cannot pass a malformed/minimal authoritative advisory record,
// closing the gap between JSON-schema data validation and the stricter TypeScript runtime
// validation performed by validateAdvisoryRecord.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(advisorySchema as Record<string, unknown>);

const validModern = {
  id: 'advisory.schema.modern',
  status: 'monitoring',
  severity: 'low',
  confidence: 'low',
  policy_action: 'inform',
  summary: 'Synthetic schema-level fixture.',
  rationale: 'Exercises the modern advisory branch of the schema.',
  affected_component_ids: ['component.a'],
  evidence_ids: [],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
};

const validLegacy = {
  id: 'advisory.schema.legacy',
  status: 'draft',
  severity: 'watch',
  title: 'Legacy advisory',
  summary: 'Synthetic legacy schema-level fixture.',
  affected: [{ component_id: 'component.a', revisions: [], serial_ranges: [] }],
  recommendation_effect: 'warn',
  evidence: [],
  manufacturer_response: null,
  review: { last_reviewed: '2026-09-01', next_review_due: '2026-10-01', reviewers: [] },
};

describe('advisory.schema.json modern/legacy consistency', () => {
  it('rejects a modern advisory with only an id', () => {
    expect(validate({ id: 'advisory.schema.only-id' })).toBe(false);
  });

  it('accepts a fully specified modern advisory', () => {
    expect(validate(validModern)).toBe(true);
  });

  it('accepts a fully specified legacy advisory', () => {
    expect(validate(validLegacy)).toBe(true);
  });

  it('rejects a modern advisory with an invalid reviewed_decision', () => {
    expect(
      validate({
        ...validModern,
        id: 'advisory.schema.bad-reviewed-decision',
        reviewed_decision: { status: 'active' },
      }),
    ).toBe(false);
  });

  it('accepts a modern advisory with a fully specified reviewed_decision', () => {
    expect(
      validate({
        ...validModern,
        id: 'advisory.schema.good-reviewed-decision',
        reviewed_decision: {
          status: 'active',
          severity: 'high',
          confidence: 'confirmed',
          policy_action: 'exclude',
          rationale: 'Reviewed against manufacturer recall notice.',
          reviewer: 'safety-reviewer@example.com',
          reviewed_at: '2026-09-03T00:00:00Z',
        },
      }),
    ).toBe(true);
  });
});
