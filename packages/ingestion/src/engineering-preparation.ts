import { createHash } from 'node:crypto';
import {
  parseEngineeringProfile,
  type EngineeringProfile,
} from '@expedition/engineering-core/engineering-profile';
import { artifactDigest, deterministicSerialize } from './production-contracts.js';

export interface EngineeringSourceBinding {
  evidence_id: string;
  source_digest: string;
  source_url: string;
  /** Exact UTF-8 source byte offsets, not browser-rendered line numbers. The
   * surrounding document stays private; public artifacts retain limited facts. */
  start_byte: number;
  end_byte: number;
  source_literal: string;
  ownership: 'native_exact_model' | 'unresolved';
  context_locators: string[];
}
export interface EngineeringPreparation {
  schema_version: 'engineering-preparation.v1';
  artifact_kind: 'provisional_engineering_preparation';
  profile: EngineeringProfile;
  bindings: EngineeringSourceBinding[];
  required_assertions: string[];
  unresolved: string[];
  review_queue: { path: string; evidence_ids: string[]; value: unknown }[];
  authority: 'agent_proposed_not_admitted';
  digest: string;
}
export interface RetainedEngineeringSource {
  source_url: string;
  publisher: string;
  retrieved_at: string;
  manufacturer_revision: string | null;
  bytes: Uint8Array;
}

/** Development/operator authoring proposal, separate from ordinary semantic
 * decisions and admission. Even fully bound source literals do not prove their
 * engineering interpretation or exact column ownership. Human qualification is
 * still required; no approved/canonical/verified artifact can be constructed. */
export function prepareEngineeringProfile(input: {
  profile: EngineeringProfile;
  bindings: EngineeringSourceBinding[];
  sources: RetainedEngineeringSource[];
  required_assertions: string[];
  unresolved: string[];
}): EngineeringPreparation {
  const profile = parseEngineeringProfile(input.profile);
  if (profile.evidence.some((e) => e.origin !== 'source_stated'))
    throw new Error('Source preparation cannot relabel synthetic facts');
  if (
    new Set(input.required_assertions).size !== input.required_assertions.length ||
    input.required_assertions.some((s) => !s.trim())
  )
    throw new Error('Invalid frozen assertion inventory');
  if (new Set(input.bindings.map((b) => b.evidence_id)).size !== input.bindings.length)
    throw new Error('Duplicate source binding');
  const bindings = structuredClone(input.bindings);
  const unresolved = [...input.unresolved];
  for (const e of profile.evidence) {
    const binding = bindings.find((b) => b.evidence_id === e.id);
    if (
      !binding ||
      e.source_digest === null ||
      binding.source_digest !== e.source_digest ||
      binding.source_url !== e.source_url
    )
      throw new Error(`Missing immutable source binding: ${e.id}`);
    const sources = input.sources.filter(
      (s) =>
        s.source_url === e.source_url &&
        s.publisher === e.publisher &&
        s.retrieved_at === e.retrieved_at &&
        s.manufacturer_revision === e.manufacturer_revision &&
        createHash('sha256').update(s.bytes).digest('hex') === e.source_digest,
    );
    if (sources.length !== 1) throw new Error(`Missing/mismatched retained source: ${e.id}`);
    const bytes = sources[0]!.bytes;
    if (
      !Number.isSafeInteger(binding.start_byte) ||
      !Number.isSafeInteger(binding.end_byte) ||
      binding.start_byte < 0 ||
      binding.end_byte <= binding.start_byte ||
      binding.end_byte > bytes.length
    )
      throw new Error(`Invalid source offsets: ${e.id}`);
    const literal = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(binding.start_byte, binding.end_byte),
    );
    if (
      literal !== binding.source_literal ||
      !e.statement.trim() ||
      !binding.context_locators.length
    )
      throw new Error(`Literal/context mismatch: ${e.id}`);
    // Native literal may contain tags/entities; the author records a readable
    // statement separately. This is NOT an automatic text-equivalence proof.
    unresolved.push(`source_interpretation_review:${e.id}`);
    if (binding.ownership === 'unresolved') unresolved.push(`source_ownership_review:${e.id}`);
  }
  if (bindings.some((b) => !profile.evidence.some((e) => e.id === b.evidence_id)))
    throw new Error('Detached source binding');
  const review_queue: EngineeringPreparation['review_queue'] = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== 'object') return;
    const r = value as Record<string, unknown>;
    if (Array.isArray(r.evidence_ids))
      review_queue.push({
        path,
        evidence_ids: r.evidence_ids as string[],
        value: structuredClone(value),
      });
    else
      for (const [key, child] of Object.entries(r))
        if (key !== 'evidence') visit(child, path ? `${path}.${key}` : key);
  };
  visit(profile, 'engineering_profile');
  const content = {
    schema_version: 'engineering-preparation.v1' as const,
    artifact_kind: 'provisional_engineering_preparation' as const,
    profile,
    bindings,
    required_assertions: [...input.required_assertions],
    unresolved: [...new Set(unresolved)].sort(),
    review_queue,
    authority: 'agent_proposed_not_admitted' as const,
  };
  return { ...content, digest: artifactDigest(content) };
}

/** Restart needs the same explicit retained bytes. No TEMP fallback, source URL
 * refetch, historic semantic upgrade or synthetic replacement is permissible. */
export function replayEngineeringPreparation(
  input: unknown,
  sources: RetainedEngineeringSource[],
): EngineeringPreparation {
  if (!input || typeof input !== 'object') throw new Error('Invalid preparation');
  const p = input as EngineeringPreparation;
  if (p.schema_version !== 'engineering-preparation.v1')
    throw new Error('Unsupported preparation version');
  const rebuilt = prepareEngineeringProfile({
    profile: p.profile,
    bindings: p.bindings,
    sources,
    required_assertions: p.required_assertions,
    unresolved: p.unresolved.filter(
      (s) =>
        !s.startsWith('source_interpretation_review:') && !s.startsWith('source_ownership_review:'),
    ),
  });
  if (deterministicSerialize(rebuilt) !== deterministicSerialize(p))
    throw new Error('Preparation differs from exact evidence replay');
  return rebuilt;
}
