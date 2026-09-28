import { buildProductCandidate } from './candidate-builder.js';
import type {
  ProductCandidate,
  ProductFact,
  ProductSource,
  ProductSourceType,
} from './contracts.js';
import { resolveCanonicalField } from './field-mapping.js';
import { normalizeProductFact } from './normalize-fact.js';
import type { NormalizedProductFact } from './normalization-types.js';
import {
  artifactDigest,
  deterministicSerialize,
  type ProductIntake,
  type QualifiedFactArtifact,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
  type SourceAcquisitionCandidate,
  type SourceCaptureArtifact,
} from './production-contracts.js';
import { buildProductionSemanticProposals } from './production-semantic-bridge.js';
import type { QualifiedFactWholeIntakeReconciliationResult } from './reconciliation.js';

export interface ProductionCandidateBridgeInput {
  readonly intake: ProductIntake;
  readonly captures: readonly SourceCaptureArtifact[];
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
  readonly facts: readonly QualifiedFactArtifact[];
  readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
  readonly proposals: readonly SemanticProposal[];
}

export interface ProductionProjectionDiagnostic {
  readonly proposal_id: string;
  readonly reason: string;
}

export interface ProductionCandidateBridgeResult {
  readonly candidate?: ProductCandidate;
  readonly proposals: readonly SemanticProposal[];
  readonly qualified_facts: readonly QualifiedFactArtifact[];
  readonly projected_proposal_ids: readonly string[];
  readonly non_projected: readonly ProductionProjectionDiagnostic[];
  readonly proposal_fact_ids: Readonly<Record<string, readonly string[]>>;
  readonly sources: readonly ProductSource[];
  readonly facts: readonly ProductFact[];
  readonly normalized_facts: readonly NormalizedProductFact[];
}

const sourceType = (
  role: SourceAcquisitionCandidate['role'] | 'product_page',
): ProductSourceType => {
  if (role === 'product_page') return 'manufacturer_product_page';
  if (role === 'datasheet' || role === 'specification_sheet') return 'manufacturer_datasheet';
  if (role === 'manual' || role === 'installation_manual' || role === 'technical_manual')
    return 'manufacturer_manual';
  if (role === 'technical_drawing' || role === 'dimensional_drawing') return 'manufacturer_drawing';
  if (role === 'certificate') return 'manufacturer_certificate';
  if (role === 'support_article') return 'manufacturer_support_article';
  return 'other';
};

const matches = (left: string, right: string | undefined): boolean =>
  right !== undefined && left.trim().toLowerCase() === right.trim().toLowerCase();

/** A target identity is a request; only fact-level identity evidence establishes applicability. */
const applicableIdentity = (
  fact: QualifiedFactArtifact,
  intake: ProductIntake,
): ProductSource['product_identity_claim'] | undefined => {
  const binding = fact.metadata.applicability;
  if (!binding.value) return undefined;
  if (
    (binding.kind === 'exact_mpn_or_sku' || binding.kind === 'exact_sku') &&
    matches(binding.value, intake.manufacturer_part_number)
  )
    return { manufacturer_part_number: binding.value };
  if (binding.kind === 'exact_product' && matches(binding.value, intake.manufacturer_part_number))
    return { manufacturer_part_number: binding.value };
  if (binding.kind === 'exact_product' && matches(binding.value, intake.product_model))
    return { model: binding.value };
  return undefined;
};

const captureFor = (
  fact: QualifiedFactArtifact,
  captures: readonly SourceCaptureArtifact[],
): SourceCaptureArtifact | undefined =>
  captures.find(
    (capture) =>
      fact.source_capture.kind === 'source_capture' &&
      artifactDigest(capture) === fact.source_capture.digest,
  );

const acquisitionFor = (
  fact: QualifiedFactArtifact,
  acquisitions: readonly SourceAcquisitionArtifact[],
): SourceAcquisitionArtifact | undefined =>
  acquisitions.find(
    (acquisition) => artifactDigest(acquisition) === fact.source_acquisition?.digest,
  );

const projectSource = (
  fact: QualifiedFactArtifact,
  input: ProductionCandidateBridgeInput,
): { readonly source?: ProductSource; readonly reason?: string } => {
  const capture = captureFor(fact, input.captures);
  const acquisition = acquisitionFor(fact, input.source_acquisitions);
  if (!capture || !acquisition || acquisition.intake.digest !== artifactDigest(input.intake))
    return {
      reason: 'source capture, acquisition, or intake reference is missing or inconsistent',
    };
  const candidate = fact.acquisition_candidate_id
    ? acquisition.candidates.find((item) => item.id === fact.acquisition_candidate_id)
    : undefined;
  const isSeed =
    !fact.acquisition_candidate_id && acquisition.seed_capture.digest === artifactDigest(capture);
  const isCandidate =
    candidate?.capture?.digest === artifactDigest(capture) &&
    candidate.officiality === 'official' &&
    candidate.capture_outcome === 'authoritative';
  if (
    capture.disposition !== 'authoritative' ||
    (!isSeed && !isCandidate) ||
    (isSeed && acquisition.officiality !== 'official')
  )
    return { reason: 'capture is not an authoritative official acquisition source' };
  const claim = applicableIdentity(fact, input.intake);
  if (!claim) return { reason: 'fact does not establish exact target applicability' };
  const publisher = capture.source_provenance?.publisher;
  if (typeof publisher !== 'string' || !publisher.trim())
    return { reason: 'capture has no supported publisher metadata' };
  const uri = capture.final_uri ?? capture.requested_uri;
  if (!uri || !capture.retrieved_at)
    return { reason: 'capture has no usable URI or retrieval timestamp' };
  const role = isSeed ? 'product_page' : (candidate?.role ?? 'unknown');
  return {
    source: {
      schema_version: '1.0',
      id: `production-source.${artifactDigest(capture).slice(7, 31)}`,
      uri,
      source_type: sourceType(role),
      authority:
        role === 'product_page'
          ? 'manufacturer_product'
          : role === 'support_article'
            ? 'manufacturer_support'
            : 'manufacturer_technical',
      publisher,
      retrieved_at: capture.retrieved_at,
      ...(capture.document_revision ? { document_revision: capture.document_revision } : {}),
      ...(capture.publication_date ? { publication_date: capture.publication_date } : {}),
      ...(capture.content_digest ? { content_hash: capture.content_digest } : {}),
      applicability: 'direct_identity',
      applicability_reason: `Qualified fact ${fact.id} has exact production applicability.`,
      product_identity_claim: claim,
    },
  };
};

export const buildProductionProductCandidate = (
  input: ProductionCandidateBridgeInput,
): ProductionCandidateBridgeResult => {
  const expected = buildProductionSemanticProposals({
    facts: input.facts,
    source_acquisitions: input.source_acquisitions,
    reconciliation: input.reconciliation,
  });
  const orderedProposals = [...input.proposals].sort((a, b) => a.id.localeCompare(b.id));
  if (deterministicSerialize(expected) !== deterministicSerialize(orderedProposals))
    throw new Error('Candidate bridge received a stale or foreign semantic proposal set.');
  const qualifiedFacts = [...input.facts].sort((a, b) => a.id.localeCompare(b.id));
  const factsByDigest = new Map(qualifiedFacts.map((fact) => [artifactDigest(fact), fact]));
  const sources = new Map<string, ProductSource>();
  const projectedFacts: ProductFact[] = [];
  const normalizedFacts: NormalizedProductFact[] = [];
  const projected: string[] = [];
  const nonProjected: ProductionProjectionDiagnostic[] = [];
  const proposalFactIds: Record<string, readonly string[]> = {};

  for (const proposal of orderedProposals) {
    if (proposal.disposition !== 'mapped' || proposal.proposed_value === undefined) {
      nonProjected.push({
        proposal_id: proposal.id,
        reason: `disposition: ${proposal.disposition}`,
      });
      continue;
    }
    const proposalFacts = (proposal.fact_refs ?? []).map((ref) => factsByDigest.get(ref.digest));
    if (!proposalFacts.length || proposalFacts.some((fact) => !fact)) {
      nonProjected.push({
        proposal_id: proposal.id,
        reason: 'qualified fact payload is unavailable',
      });
      continue;
    }
    const staged: {
      source: ProductSource;
      fact: ProductFact;
      normalized: NormalizedProductFact;
    }[] = [];
    let reason: string | undefined;
    for (const fact of proposalFacts as QualifiedFactArtifact[]) {
      const mapping = fact.metadata.source_label
        ? resolveCanonicalField(fact.metadata.source_label)
        : undefined;
      if (
        !mapping ||
        mapping.target_kind === 'evidence' ||
        mapping.canonical_field !== proposal.target
      ) {
        reason = 'source label has no matching canonical mapping';
        break;
      }
      const sourceResult = projectSource(fact, input);
      if (!sourceResult.source) {
        reason = sourceResult.reason;
        break;
      }
      const legacyFact: ProductFact = {
        schema_version: '1.0',
        id: `production-fact.${artifactDigest(fact).slice(7, 31)}`,
        source_id: sourceResult.source.id,
        field: mapping.canonical_field,
        raw_label: fact.metadata.source_label!,
        raw_value: fact.metadata.raw_value,
        ...(fact.metadata.source_unit ? { raw_unit: fact.metadata.source_unit } : {}),
        extraction_method: 'other',
        fact_state: 'provisional',
        review_required: true,
      };
      const normalized = normalizeProductFact(legacyFact, sourceResult.source);
      if (normalized.status !== 'normalized' || !normalized.fact) {
        reason = `legacy normalization: ${normalized.issues.map((issue) => issue.code).join(', ')}`;
        break;
      }
      if (proposal.qualified_value) {
        if (
          !normalized.fact.fact.qualified_value ||
          deterministicSerialize({
            ...normalized.fact.fact.qualified_value,
            id: proposal.qualified_value.id,
          }) !== deterministicSerialize(proposal.qualified_value)
        ) {
          reason = 'qualified value differs from source normalization';
          break;
        }
        const projectedFact = {
          ...normalized.fact.fact,
          qualified_value: proposal.qualified_value,
        };
        staged.push({
          source: sourceResult.source,
          fact: projectedFact,
          normalized: { ...normalized.fact, fact: projectedFact },
        });
      } else
        staged.push({ source: sourceResult.source, fact: legacyFact, normalized: normalized.fact });
    }
    if (reason) {
      nonProjected.push({ proposal_id: proposal.id, reason });
      continue;
    }
    staged.forEach((item) => {
      sources.set(item.source.id, item.source);
      projectedFacts.push(item.fact);
      normalizedFacts.push(item.normalized);
    });
    projected.push(proposal.id);
    proposalFactIds[proposal.id] = staged.map((item) => item.fact.id).sort();
  }
  const orderedSources = [...sources.values()].sort((a, b) => a.id.localeCompare(b.id));
  projectedFacts.sort((a, b) => a.id.localeCompare(b.id));
  normalizedFacts.sort((a, b) => a.fact.id.localeCompare(b.fact.id));
  const candidate = projectedFacts.length
    ? buildProductCandidate({
        id: `production-candidate.${artifactDigest(input.intake).slice(7, 31)}`,
        identity: {
          manufacturer: input.intake.manufacturer,
          model: input.intake.product_model,
          ...(input.intake.manufacturer_part_number
            ? { manufacturer_part_number: input.intake.manufacturer_part_number }
            : {}),
        },
        sources: orderedSources,
        facts: projectedFacts,
        normalized_facts: normalizedFacts,
      })
    : undefined;
  return {
    ...(candidate ? { candidate } : {}),
    proposals: orderedProposals,
    qualified_facts: qualifiedFacts,
    projected_proposal_ids: projected,
    non_projected: nonProjected,
    proposal_fact_ids: proposalFactIds,
    sources: orderedSources,
    facts: projectedFacts,
    normalized_facts: normalizedFacts,
  };
};
