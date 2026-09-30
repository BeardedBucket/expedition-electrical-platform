import { buildProductCandidate } from './candidate-builder.js';
import type {
  ProductCandidate,
  ProductDerivation,
  ProductFact,
  ProductSource,
  ProductSourceType,
} from './contracts.js';
import { resolveProductionCanonicalField } from './field-mapping.js';
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
import { reviewedSemanticContext } from './semantic-context.js';
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

const platformDerivedSourceId = 'platform.derived';

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
    if (proposal.derivation) continue;
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
      const reviewedContext = reviewedSemanticContext(fact, input.facts, input.source_acquisitions);
      const mapping = fact.metadata.source_label
        ? resolveProductionCanonicalField(fact.metadata.source_label, reviewedContext)
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
        id: `production-fact.${artifactDigest(mapping.normalize_observations ? { qualified_fact: artifactDigest(fact), assertion: proposal.qualified_value } : fact).slice(7, 31)}`,
        source_id: sourceResult.source.id,
        field: mapping.canonical_field,
        raw_label: fact.metadata.source_label!,
        raw_value: fact.metadata.raw_value,
        ...(fact.metadata.source_unit ? { raw_unit: fact.metadata.source_unit } : {}),
        extraction_method: 'other',
        fact_state: 'provisional',
        review_required: true,
      };
      const normalized = normalizeProductFact(
        legacyFact,
        sourceResult.source,
        proposal.qualified_value
          ? {
              value: proposal.qualified_value.value,
              qualifiers: proposal.qualified_value.qualifiers,
            }
          : undefined,
        reviewedContext,
      );
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
  const derivedFields: Record<string, ProductDerivation> = {};
  let platformDerivedSource: ProductSource | undefined;
  for (const proposal of orderedProposals.filter((item) => item.derivation)) {
    if (
      proposal.disposition !== 'mapped' ||
      proposal.proposed_value === undefined ||
      !proposal.derivation
    ) {
      nonProjected.push({
        proposal_id: proposal.id,
        reason: `derived disposition: ${proposal.disposition}`,
      });
      continue;
    }
    const supporting = proposal.derivation.input_targets.map((target) =>
      orderedProposals.find(
        (item) =>
          item.target === target &&
          !item.derivation &&
          item.disposition === 'mapped' &&
          projected.includes(item.id),
      ),
    );
    if (supporting.some((item) => !item)) {
      nonProjected.push({ proposal_id: proposal.id, reason: 'derived input was not projected' });
      continue;
    }
    const inputFactIds = [
      ...new Set(supporting.flatMap((item) => proposalFactIds[item!.id] ?? [])),
    ].sort();
    const inputFacts = inputFactIds
      .map((id) => projectedFacts.find((fact) => fact.id === id))
      .filter((fact): fact is ProductFact => fact !== undefined);
    const inputSources = [
      ...new Map(
        inputFacts
          .map((fact) => sources.get(fact.source_id))
          .filter((source): source is ProductSource => source !== undefined)
          .map((source) => [source.id, source] as const),
      ).values(),
    ].sort((left, right) => left.id.localeCompare(right.id));
    if (
      inputFactIds.length === 0 ||
      inputFacts.length !== inputFactIds.length ||
      inputSources.length === 0 ||
      inputFacts.some((fact) => !sources.has(fact.source_id))
    ) {
      nonProjected.push({
        proposal_id: proposal.id,
        reason: 'derived input source lineage is unavailable',
      });
      continue;
    }
    const derivation = {
      ...proposal.derivation,
      input_qualified_fact_ids: proposal.derivation.input_qualified_fact_ids,
      input_fact_ids: inputFactIds,
    };
    if (!platformDerivedSource) {
      platformDerivedSource = {
        schema_version: '1.0',
        id: platformDerivedSourceId,
        uri: 'platform://derived',
        source_type: 'other',
        authority: 'unknown',
        publisher: 'platform',
        retrieved_at: '1970-01-01T00:00:00.000Z',
        applicability: 'explicitly_reviewed',
        applicability_reason: 'Platform-derived value from published input facts.',
        notes:
          'A derived product fact belongs to the platform derivation layer, not an arbitrary manufacturer source.',
      };
    }
    // A separate calculated fact lets ordinary candidate validation and
    // promotion bind the output field to its own evidence ID. Reusing input
    // fact IDs would falsely label those published facts as the derived field.
    const derivedFact: ProductFact = {
      schema_version: '1.0',
      id: `production-derived-fact.${artifactDigest(proposal).slice(7, 31)}`,
      source_id: platformDerivedSource.id,
      field: proposal.target,
      raw_label: `Derived: ${proposal.target}`,
      raw_value: proposal.proposed_value,
      normalized_value: proposal.proposed_value,
      normalized_unit: proposal.derivation.output_unit,
      extraction_method: 'other',
      fact_state: 'provisional',
      review_required: true,
      transformation_notes: `${derivation.rule_version}: ${derivation.formula}`,
      derivation,
    };
    projectedFacts.push(derivedFact);
    normalizedFacts.push({
      fact: derivedFact,
      source: platformDerivedSource,
      canonical_field: proposal.target,
      normalized_value: proposal.proposed_value,
      normalized_unit: derivation.output_unit,
      dimension: proposal.derivation.output_unit === 'count' ? 'count' : 'capacity',
      source_authority: platformDerivedSource.authority,
      target_kind: 'canonical',
    });
    derivedFields[proposal.target] = derivation;
    proposalFactIds[proposal.id] = [derivedFact.id];
    projected.push(proposal.id);
  }
  const orderedSources = [...sources.values()].sort((a, b) => a.id.localeCompare(b.id));
  const candidateSources = platformDerivedSource
    ? [...orderedSources, platformDerivedSource].sort((a, b) => a.id.localeCompare(b.id))
    : orderedSources;
  projectedFacts.sort((a, b) => a.id.localeCompare(b.id));
  normalizedFacts.sort((a, b) => a.fact.id.localeCompare(b.fact.id));
  let candidate = projectedFacts.length
    ? buildProductCandidate({
        id: `production-candidate.${artifactDigest(input.intake).slice(7, 31)}`,
        identity: {
          manufacturer: input.intake.manufacturer,
          model: input.intake.product_model,
          ...(input.intake.manufacturer_part_number
            ? { manufacturer_part_number: input.intake.manufacturer_part_number }
            : {}),
        },
        sources: candidateSources,
        facts: projectedFacts,
        normalized_facts: normalizedFacts,
      })
    : undefined;
  if (candidate) {
    const inconsistent = orderedProposals.some(
      (item) => item.derivation && item.disposition === 'conflicting',
    );
    candidate = {
      ...candidate,
      ...(Object.keys(derivedFields).length ? { derived_fields: derivedFields } : {}),
      ...(inconsistent
        ? {
            promotion_status: 'blocked',
            review_status: 'pending',
            review_reasons: [
              ...(candidate.review_reasons ?? []),
              'published_derived_inconsistency',
            ],
          }
        : {}),
    };
  }
  return {
    ...(candidate ? { candidate } : {}),
    proposals: orderedProposals,
    qualified_facts: qualifiedFacts,
    projected_proposal_ids: projected,
    non_projected: nonProjected,
    proposal_fact_ids: proposalFactIds,
    sources: candidateSources,
    facts: projectedFacts,
    normalized_facts: normalizedFacts,
  };
};
