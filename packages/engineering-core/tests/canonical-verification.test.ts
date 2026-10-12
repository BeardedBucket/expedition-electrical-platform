// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canonicalEngineeringContent,
  canonicalEngineeringDigest,
  canonicalLineageDigest,
  canonicalVerificationEventId,
  canonicalVerificationHistoryValid,
  hasCurrentCanonicalVerification,
  CANONICAL_VERIFICATION_REVISION,
  type CanonicalVerificationEvent,
} from '../src/canonical-verification.js';
import { evaluateProductSelection } from '../src/product-selection.js';
import { converterProduct, selectionRequest } from './fixtures/selection.js';
import { normalizeComponentLibraryRecord } from '../src/component-library.js';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const eventFor = (record: Record<string, unknown>): CanonicalVerificationEvent => {
  const content: Omit<CanonicalVerificationEvent, 'id'> = {
    revision: 1,
    policy_version: CANONICAL_VERIFICATION_REVISION,
    actor: { kind: 'operator_label', identifier: 'Synthetic local label' },
    authority_boundary: 'trusted_local_operator',
    recorded_at: '2026-01-01T00:00:00Z',
    component_id: String(record.id),
    content_snapshot: canonicalEngineeringContent(record),
    content_digest: canonicalEngineeringDigest(record),
    lineage_digest: canonicalLineageDigest(record),
    promotion_binding: {
      job_id: 'synthetic-job',
      approval_digest: `sha256:${'a'.repeat(64)}`,
      promotion_digest: `sha256:${'b'.repeat(64)}`,
      write_digest: `sha256:${'c'.repeat(64)}`,
    },
  };
  return { id: canonicalVerificationEventId(content), ...content };
};
describe('canonical verification and Phase 5 authority', () => {
  it('accepts only an unchanged exact event and rejects status-only verified authority', () => {
    const record = converterProduct(),
      verified = { ...record, engineering_verification_history: [eventFor(record)] };
    expect(hasCurrentCanonicalVerification(verified)).toBe(true);
    expect(hasCurrentCanonicalVerification(record)).toBe(false);
    expect(canonicalVerificationHistoryValid(record)).toBe(false);
    expect(() => evaluateProductSelection(selectionRequest([record]))).toThrow(/stale or invalid/);
    expect(hasCurrentCanonicalVerification({ ...record, verification_status: 'unverified' })).toBe(
      false,
    );
    expect(
      evaluateProductSelection(selectionRequest([{ ...record, verification_status: 'unverified' }]))
        .roles[0].candidates[0].status,
    ).toBe('UNRESOLVED');
    expect(
      evaluateProductSelection(selectionRequest([verified])).roles[0].candidates[0].status,
    ).toBe('ELIGIBLE');
  });
  it.each([
    (r: Record<string, unknown>) => {
      r.weight_kg = 42;
    },
    (r: Record<string, unknown>) => {
      delete r.ports;
      delete r.power_paths;
    },
    (r: Record<string, unknown>) => {
      r.source_refs = [];
    },
    (r: Record<string, unknown>) => {
      r.manufacturer_revision = 'new';
    },
    (r: Record<string, unknown>) => {
      r.future_engineering_assertion = 'new';
    },
  ])('makes changed content stale while retaining valid historical evidence', (change) => {
    const original = converterProduct(),
      record = copy({ ...original, engineering_verification_history: [eventFor(original)] });
    change(record);
    expect(canonicalVerificationHistoryValid(record)).toBe(true);
    expect(hasCurrentCanonicalVerification(record)).toBe(false);
    expect(() => evaluateProductSelection(selectionRequest([record]))).toThrow(/stale or invalid/);
    expect(
      evaluateProductSelection(selectionRequest([{ ...record, verification_status: 'unverified' }]))
        .roles[0].candidates[0].status,
    ).toBe('UNRESOLVED');
  });
  it('rejects corrupt event identity, chronology, source snapshot and unsupported actor assurance', () => {
    const original = converterProduct(),
      record = { ...original, engineering_verification_history: [eventFor(original)] };
    for (const mutate of [
      (e: Record<string, unknown>) => {
        e.id = 'wrong';
      },
      (e: Record<string, unknown>) => {
        e.revision = 2;
      },
      (e: Record<string, unknown>) => {
        e.actor = { kind: 'authenticated', identifier: 'fake' };
      },
      (e: Record<string, unknown>) => {
        e.content_snapshot = { id: original.id, weight_kg: 42 };
      },
    ]) {
      const changed = copy(record);
      mutate(changed.engineering_verification_history[0] as unknown as Record<string, unknown>);
      expect(canonicalVerificationHistoryValid(changed)).toBe(false);
    }
  });
  it('does not materialize empty or null unknowns in workflow records', () => {
    const record = {
      id: 'synthetic.unknown',
      manufacturer: 'Neutral',
      model: 'Unknown',
      verification_status: 'verified',
    };
    const verified = { ...record, engineering_verification_history: [eventFor(record)] };
    expect(normalizeComponentLibraryRecord(verified)).toEqual(verified);
    expect(normalizeComponentLibraryRecord(verified)).not.toHaveProperty('battery');
    expect(normalizeComponentLibraryRecord(verified)).not.toHaveProperty('ports');
    expect(hasCurrentCanonicalVerification(normalizeComponentLibraryRecord(verified))).toBe(true);
  });
});
