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
  type ReviewedSemanticDecision,
} from './production-contracts.js';
import {
  productionSemanticFieldDescriptor,
  normalizeProductionSemanticTarget,
} from './field-mapping.js';
import {
  buildReviewedSemanticInterpretation,
  deterministicNormalizedValuesEqual,
  effectiveReviewedSemanticSourceUnit,
} from './reviewed-semantic.js';
import { parseExactUnitValue, resolveUnit } from './units.js';
import { reviewedSemanticContext } from './semantic-context.js';
import { replaySemanticAssertion, recognizeSemanticAssertion } from './semantic-rules.js';
import type { QualifiedFactWholeIntakeReconciliationResult } from './reconciliation.js';
import { isQualificationProvenance } from './qualified-context.js';
import { previewHumanMapping } from './human-adjudication.js';

export interface ProductionCandidateBridgeInput {
  readonly intake: ProductIntake;
  readonly captures: readonly SourceCaptureArtifact[];
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
  readonly facts: readonly QualifiedFactArtifact[];
  readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
  readonly proposals: readonly SemanticProposal[];
  readonly reviewed_semantic_decisions?: readonly ReviewedSemanticDecision[];
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
  readonly reviewed_semantic_interpretation: ReturnType<typeof buildReviewedSemanticInterpretation>;
  readonly reviewed_semantic_decisions: readonly ReviewedSemanticDecision[];
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
  const interpretation = buildReviewedSemanticInterpretation({
    intake: input.intake,
    source_acquisitions: input.source_acquisitions,
    facts: input.facts,
    reconciliation: input.reconciliation,
    proposals: input.proposals,
    decisions: input.reviewed_semantic_decisions,
  });
  const orderedProposals = [...input.proposals].sort((a, b) => a.id.localeCompare(b.id));
  const qualifiedFacts = [...input.facts].sort((a, b) => a.id.localeCompare(b.id));
  const factsByDigest = new Map(qualifiedFacts.map((fact) => [artifactDigest(fact), fact]));
  const sources = new Map<string, ProductSource>();
  const projectedFacts: ProductFact[] = [];
  const normalizedFacts: NormalizedProductFact[] = [];
  const projected: string[] = [];
  const nonProjected: ProductionProjectionDiagnostic[] = [];
  const proposalFactIds: Record<string, readonly string[]> = {};
  const interpretationByProposal = new Map(
    interpretation.entries.map((entry) => [entry.proposal_id, entry] as const),
  );
  const effectiveTargets = new Map<string, string>();

  for (const proposal of orderedProposals) {
    if (proposal.derivation) continue;
    const reviewed = interpretationByProposal.get(proposal.id);
    const useHumanMapping = reviewed?.state === 'human_mapped';
    const effectiveTarget = useHumanMapping ? reviewed.target! : proposal.target;
    const effectiveValue = useHumanMapping ? reviewed.value : proposal.proposed_value;
    const effectiveDisposition = useHumanMapping ? 'mapped' : proposal.disposition;
    const disposition =
      reviewed?.state && reviewed.state !== 'automatic' ? reviewed.state : proposal.disposition;
    if (reviewed && reviewed.state !== 'automatic' && !useHumanMapping) {
      nonProjected.push({ proposal_id: proposal.id, reason: `disposition: ${disposition}` });
      continue;
    }
    if (proposal.disposition !== 'mapped' || proposal.proposed_value === undefined) {
      if (!useHumanMapping) {
        nonProjected.push({
          proposal_id: proposal.id,
          reason: `disposition: ${disposition}`,
        });
        continue;
      }
    }
    if (effectiveDisposition !== 'mapped' || effectiveValue === undefined) {
      nonProjected.push({
        proposal_id: proposal.id,
        reason: `disposition: ${disposition}`,
      });
      continue;
    }
    const refs =
      useHumanMapping && reviewed.selected_fact_refs
        ? reviewed.selected_fact_refs
        : (proposal.fact_refs ?? []);
    const proposalFacts = refs.map((ref) => factsByDigest.get(ref.digest));
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
      // Frozen artifacts retain their historical interpretation, but replay is
      // not permission to discard now-identifiable source conditions or promote
      // a maximum as continuous. Abstain explicitly; never rewrite old evidence.
      if (!useHumanMapping && !proposal.semantic_assertions && !proposal.qualified_value) {
        if (
          fact.evidence?.some(
            (e) =>
              (e.role === 'context' || e.role === 'qualifier') &&
              !isQualificationProvenance(e, fact),
          )
        ) {
          reason = 'legacy scalar replay cannot discard semantic or untyped context evidence';
          break;
        }
        const assertion = recognizeSemanticAssertion(fact, input.facts);
        if (
          assertion &&
          (assertion.review_required_reasons.includes('qualifier_context_unresolved') ||
            assertion.qualifiers.source_conditions?.length ||
            assertion.qualifiers.duration !== undefined ||
            assertion.qualifiers.temperature_context !== undefined ||
            assertion.qualifiers.revision_context !== undefined ||
            assertion.qualifiers.comparison !== undefined ||
            (proposal.target.includes('continuous') &&
              ['maximum', 'rated_maximum', 'peak', 'surge'].includes(
                assertion.qualifiers.rating_basis ?? '',
              )))
        ) {
          reason =
            'legacy scalar replay would discard source qualifiers or reinterpret a non-continuous rating';
          break;
        }
      }
      if (!useHumanMapping && proposal.semantic_assertions) {
        const stored = proposal.semantic_assertions.find(
          (s) => s.source_fact_id === fact.id && s.source_fact_digest === artifactDigest(fact),
        );
        const a = stored && replaySemanticAssertion(fact, input.facts, stored);
        if (
          !a ||
          a.review_required_reasons.length ||
          !proposal.semantic_assertions.some(
            (s) => deterministicSerialize(s) === deterministicSerialize(a),
          )
        ) {
          reason = 'generic semantic rule or source assertion changed';
          break;
        }
        const sourceResult = projectSource(fact, input);
        if (!sourceResult.source) {
          reason = sourceResult.reason;
          break;
        }
        const contextFacts = input.facts.filter(
          (p) =>
            p.source_capture.digest === fact.source_capture.digest &&
            p.metadata.applicability.kind === fact.metadata.applicability.kind &&
            p.metadata.applicability.value === fact.metadata.applicability.value &&
            [
              'power type - ac dc',
              'product type',
              'product role',
              'dimension scope',
              'physical scope',
            ].includes(p.metadata.source_label?.trim().toLowerCase() ?? ''),
        );
        const projectedFact: ProductFact = {
          schema_version: '1.0',
          id: `production-fact.${artifactDigest({ fact: artifactDigest(fact), proposal: proposal.id }).slice(7, 31)}`,
          source_id: sourceResult.source.id,
          field: a.target,
          raw_label: fact.metadata.source_label!,
          raw_value: fact.metadata.raw_value,
          ...(fact.metadata.source_unit ? { raw_unit: fact.metadata.source_unit } : {}),
          normalized_value: a.normalized_value!,
          normalized_unit: a.normalized_unit,
          ...(proposal.qualified_value ? { qualified_value: proposal.qualified_value } : {}),
          semantic_source: { fact, context_facts: contextFacts, assertion: a },
          normalization: {
            method: 'semantic_normalization',
            method_version: a.rule.interpreter,
            normalized_unit: a.normalized_unit,
          },
          extraction_method: 'other',
          fact_state: 'provisional',
          review_required: true,
        };
        staged.push({
          source: sourceResult.source,
          fact: projectedFact,
          normalized: {
            fact: projectedFact,
            source: sourceResult.source,
            canonical_field: a.target,
            normalized_value: a.normalized_value!,
            normalized_unit: a.normalized_unit,
            dimension: a.rule.definition.dimension,
            source_authority: sourceResult.source.authority,
            target_kind: 'canonical',
          },
        });
        continue;
      }
      const reviewedContext = reviewedSemanticContext(fact, input.facts, input.source_acquisitions);
      if (useHumanMapping && reviewed.human_mapping) {
        const preview = previewHumanMapping(fact, reviewed.human_mapping);
        const sourceResult = projectSource(fact, input);
        if (!sourceResult.source) {
          reason = sourceResult.reason;
          break;
        }
        const humanFact: ProductFact = {
          schema_version: '1.0',
          id: `production-fact.${artifactDigest({ fact, decision: reviewed.decision_ref }).slice(7, 31)}`,
          source_id: sourceResult.source.id,
          field: preview.target,
          raw_label: fact.metadata.source_label!,
          raw_value: fact.metadata.raw_value,
          ...(fact.metadata.source_unit ? { raw_unit: fact.metadata.source_unit } : {}),
          normalized_value: preview.normalized_value,
          normalized_unit: preview.normalized_unit,
          ...(preview.qualified_value ? { qualified_value: preview.qualified_value } : {}),
          human_source: fact,
          extraction_method: 'manual',
          fact_state: 'provisional',
          review_required: true,
          normalization: {
            method: 'semantic_normalization',
            method_version: 'human-adjudication.v1',
            normalized_unit: preview.normalized_unit,
          },
          transformation_notes: `Evidence-bound human decision ${reviewed.decision_ref?.reference}`,
        };
        staged.push({
          source: sourceResult.source,
          fact: humanFact,
          normalized: {
            fact: humanFact,
            source: sourceResult.source,
            canonical_field: preview.target,
            normalized_value: preview.normalized_value,
            normalized_unit: preview.normalized_unit,
            dimension: resolveUnit(preview.normalized_unit)?.dimension ?? 'structured',
            source_authority: sourceResult.source.authority,
            target_kind: 'canonical',
          },
        });
        continue;
      }
      const mapping = useHumanMapping
        ? undefined
        : fact.metadata.source_label
          ? resolveProductionCanonicalField(fact.metadata.source_label, reviewedContext)
          : undefined;
      if (
        !useHumanMapping &&
        (!mapping ||
          mapping.target_kind === 'evidence' ||
          mapping.canonical_field !== proposal.target)
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
        id: `production-fact.${artifactDigest(useHumanMapping ? { qualified_fact: artifactDigest(fact), decision: reviewed?.decision_ref?.digest, target: effectiveTarget, value: effectiveValue } : mapping!.normalize_observations ? { qualified_fact: artifactDigest(fact), assertion: proposal.qualified_value } : fact).slice(7, 31)}`,
        source_id: sourceResult.source.id,
        field: effectiveTarget,
        raw_label: fact.metadata.source_label ?? fact.metadata.source_wording,
        raw_value: fact.metadata.raw_value,
        ...(fact.metadata.source_unit ? { raw_unit: fact.metadata.source_unit } : {}),
        extraction_method: 'other',
        fact_state: 'provisional',
        review_required: true,
      };
      if (useHumanMapping) {
        const descriptor = productionSemanticFieldDescriptor(
          effectiveTarget,
          reviewedContext?.role,
          reviewedContext?.region,
        );
        if (!descriptor) {
          reason = `canonical target '${effectiveTarget}' is incompatible with source context`;
          break;
        }
        const sourceUnit = effectiveReviewedSemanticSourceUnit(fact, reviewed?.source_unit);
        const recalculated = normalizeProductionSemanticTarget(
          effectiveTarget,
          fact.metadata.raw_value,
          sourceUnit,
          reviewedContext,
          fact.metadata.source_label ?? fact.metadata.source_wording,
        );
        if (
          !recalculated ||
          !deterministicNormalizedValuesEqual(recalculated.value, effectiveValue)
        ) {
          reason = `reviewed value is not supported by retained source fact '${fact.id}'`;
          break;
        }
        const targetUnit = resolveUnit(descriptor.unit);
        const parsed = targetUnit
          ? parseExactUnitValue(fact.metadata.raw_value, sourceUnit)
          : undefined;
        const effectiveSourceUnit = recalculated.sourceUnit ?? sourceUnit;
        const sourceDefinition =
          effectiveSourceUnit === undefined ? undefined : resolveUnit(effectiveSourceUnit);
        const normalizationSourceUnit = parsed?.unit.symbol ?? sourceDefinition?.symbol;
        const normalization = {
          method:
            sourceDefinition && targetUnit && sourceDefinition.id !== targetUnit.id
              ? ('unit_conversion' as const)
              : ('semantic_normalization' as const),
          ...(normalizationSourceUnit ? { source_unit: normalizationSourceUnit } : {}),
          ...(descriptor.unit !== 'structured' && descriptor.unit !== 'string'
            ? { normalized_unit: descriptor.unit }
            : {}),
          method_version: descriptor.normalizer_version,
        };
        const humanFact = {
          ...legacyFact,
          normalized_value: effectiveValue,
          normalized_unit: descriptor.unit,
          normalization,
          transformation_notes: `Human semantic decision ${reviewed?.decision_ref?.reference ?? ''} mapped retained evidence to '${effectiveTarget}'.`,
        };
        const normalizedFact: NormalizedProductFact = {
          fact: humanFact,
          source: sourceResult.source,
          canonical_field: effectiveTarget,
          normalized_value: effectiveValue,
          normalized_unit: descriptor.unit,
          dimension: descriptor.dimension,
          source_authority: sourceResult.source.authority,
          target_kind: 'canonical',
        };
        staged.push({ source: sourceResult.source, fact: humanFact, normalized: normalizedFact });
        continue;
      }
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
      const sourceUnitText =
        fact.metadata.source_unit ??
        (typeof fact.metadata.raw_value === 'string'
          ? fact.metadata.raw_value.match(/\b(mm|cm|in|ft|m|vdc|vac|mv|kv|v|ma|ka|a)\b/i)?.[1]
          : undefined);
      const sourceUnit =
        (sourceUnitText ? resolveUnit(sourceUnitText) : undefined) ??
        parseExactUnitValue(fact.metadata.raw_value)?.unit;
      const normalizedUnit = resolveUnit(normalized.fact.normalized_unit);
      const productionFact = {
        ...normalized.fact.fact,
        normalization: {
          method:
            sourceUnit && normalizedUnit && sourceUnit.id !== normalizedUnit.id
              ? ('unit_conversion' as const)
              : ('semantic_normalization' as const),
          ...(sourceUnit ? { source_unit: sourceUnit.symbol } : {}),
          ...(normalized.fact.normalized_unit !== 'structured' &&
          normalized.fact.normalized_unit !== 'string'
            ? { normalized_unit: normalized.fact.normalized_unit }
            : {}),
          method_version: 'product-fact-normalization.v1',
        },
      };
      if (proposal.qualified_value) {
        if (
          !productionFact.qualified_value ||
          deterministicSerialize({
            ...productionFact.qualified_value,
            id: proposal.qualified_value.id,
          }) !== deterministicSerialize(proposal.qualified_value)
        ) {
          reason = 'qualified value differs from source normalization';
          break;
        }
        const projectedFact = {
          ...productionFact,
          qualified_value: proposal.qualified_value,
        };
        staged.push({
          source: sourceResult.source,
          fact: projectedFact,
          normalized: { ...normalized.fact, fact: projectedFact },
        });
      } else
        staged.push({
          source: sourceResult.source,
          fact: productionFact,
          normalized: { ...normalized.fact, fact: productionFact },
        });
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
    effectiveTargets.set(proposal.id, effectiveTarget);
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
          effectiveTargets.get(item.id) === target &&
          !item.derivation &&
          (item.disposition === 'mapped' ||
            interpretationByProposal.get(item.id)?.state === 'human_mapped') &&
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
    reviewed_semantic_interpretation: interpretation,
    reviewed_semantic_decisions: input.reviewed_semantic_decisions ?? [],
  };
};
