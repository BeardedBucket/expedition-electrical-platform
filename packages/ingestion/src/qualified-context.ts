import type { QualifiedFactArtifact, QualifiedFactEvidence } from './production-contracts.js';

export const QUALIFIED_CONTEXT_POLICY = 'qualified-context.v1';
export interface QualifiedContext {
  readonly policy_version: typeof QUALIFIED_CONTEXT_POLICY;
  readonly kind: 'source_semantic' | 'qualification_provenance' | 'unresolved';
  readonly producer:
    'profile-qualified-evidence' | 'document-qualification' | 'model-column-qualification';
  readonly producer_revision: 2;
  /** Structural ownership of an explicit dimension region in a unique source
   * Product. This is body scope, never installed orientation or clearance. */
  readonly physical_scope?: 'product_body';
}

/** Producers declare their known purpose, never a text-derived classification.
 * The source fact retains the whole item even when interpretation ignores it. */
export const qualifiedContext = (
  kind: QualifiedContext['kind'],
  producer: QualifiedContext['producer'],
): QualifiedContext => ({
  policy_version: QUALIFIED_CONTEXT_POLICY,
  kind,
  producer,
  producer_revision: 2,
});

export const qualifiedContextValid = (context: QualifiedContext | undefined): boolean =>
  !!context &&
  context.policy_version === QUALIFIED_CONTEXT_POLICY &&
  context.producer_revision === 2 &&
  ['source_semantic', 'qualification_provenance', 'unresolved'].includes(context.kind) &&
  ['profile-qualified-evidence', 'document-qualification', 'model-column-qualification'].includes(
    context.producer,
  ) &&
  (context.physical_scope === undefined ||
    (context.physical_scope === 'product_body' &&
      context.kind === 'source_semantic' &&
      context.producer === 'document-qualification'));

/** Provenance claims must still identify this fact's owning evidence. Unsupported
 * revisions, foreign references and untyped persisted context remain semantic
 * unknowns. This is replay validation, not authentication of a filesystem owner. */
export const isQualificationProvenance = (
  item: QualifiedFactEvidence,
  fact: QualifiedFactArtifact,
): boolean =>
  item.role === 'context' &&
  qualifiedContextValid(item.context) &&
  item.context!.kind === 'qualification_provenance' &&
  !!item.source_reference &&
  [fact.document_extraction, fact.source_capture].some(
    (ref) =>
      ref?.kind === item.source_reference!.kind && ref.digest === item.source_reference!.digest,
  );

export const isSourceSemanticContext = (item: QualifiedFactEvidence): boolean =>
  (item.role === 'qualifier' && item.context === undefined) ||
  (qualifiedContextValid(item.context) && item.context!.kind === 'source_semantic');
